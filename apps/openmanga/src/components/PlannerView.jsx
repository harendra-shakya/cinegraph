import React, { useState, useEffect, useRef } from 'react';
import ImageEditorModal from './ImageEditorModal';
import StatusMessage from './ui/StatusMessage';
import { analyzeStory as requestAnalyzeStory, approveChapterPlan, createChapter, generatePage as requestGeneratePage, generatePersistedPanel, getGenerationHistory, getProject, planStory as requestPlanStory, resumeGenerationJob, saveAsset, startGenerationJob, updatePersistedPanel, updateProject } from '../lib/api.mjs';
import { fetchAssetsAsReferences, getDisplayImageSrc, inlineImageToSavePayload, toInlineImageDataUrl } from '../lib/assets.mjs';
import { clearInlineGeneratedResults, getPageGenerationSettings, getPersistedOrTransientResult, mergePageAtIndex, updatePageGeneratedAsset } from '../lib/projectPages.mjs';
import { parseStoryboardResult } from '../lib/results.mjs';

const fallbackDefaults = {
    genMode: 'full',
    colorMode: 'bw',
    textDensity: 'minimal',
    aspectRatio: 'portrait',
    artStyle: 'storybook_classic',
};

const PlannerView = ({ aiDefaults, library, onSendToCreator, projectId, initialMetadata, onUsageUpdate, appMode, onProjectUpdate, onNotify }) => {
    const pageUploadRefs = useRef({});
    const [fullStory, setFullStory] = useState(initialMetadata?.story || '');
    const [isPlanning, setIsPlanning] = useState(false);
    const [plannedPages, setPlannedPages] = useState([]);
    const [targetPageCount, setTargetPageCount] = useState(0);
    const [isLocalUpdate, setIsLocalUpdate] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [storyBible, setStoryBible] = useState(initialMetadata?.series?.storyBible || null);
    const [storyBibleText, setStoryBibleText] = useState(initialMetadata?.series?.storyBible ? JSON.stringify(initialMetadata.series.storyBible, null, 2) : '');
    const [isAnalyzingStory, setIsAnalyzingStory] = useState(false);
    const [mangaBrief, setMangaBrief] = useState(initialMetadata?.mangaBrief?.text || '');
    const [activeChapterId, setActiveChapterId] = useState(initialMetadata?.chapters?.find((chapter) => chapter?.id)?.id || '');

    const [defaultSettings, setDefaultSettings] = useState({ ...fallbackDefaults, ...(aiDefaults || {}) });

    const [pageSettings, setPageSettings] = useState({});
    const [generatingPages, setGeneratingPages] = useState({});
    const [generatingPanels, setGeneratingPanels] = useState({});
    const [generatedResults, setGeneratedResults] = useState({});
    const [batchProgress, setBatchProgress] = useState(null);
    const [generationQueue, setGenerationQueue] = useState(initialMetadata?.generationQueue || { items: [], state: 'idle' });
    const [generationHistory, setGenerationHistory] = useState([]);
    const [expandedPages, setExpandedPages] = useState({});
    const [editingPageIndex, setEditingPageIndex] = useState(null);
    const [editingImageData, setEditingImageData] = useState(null);

    const buildPageSettingsMap = (pages, fallbackSettings = defaultSettings) => {
        const nextSettings = {};
        (pages || []).forEach((page, idx) => {
            nextSettings[idx] = getPageGenerationSettings(page, fallbackSettings);
        });
        return nextSettings;
    };

    const hydratePlannedPages = (pages, fallbackSettings = defaultSettings) => (
        (pages || []).map((page) => ({
            ...page,
            generationSettings: getPageGenerationSettings(page, fallbackSettings),
        }))
    );

    useEffect(() => {
        if (initialMetadata && !isLocalUpdate) {
            const activeChapter = initialMetadata.chapters?.find((chapter) => chapter.id === activeChapterId);
            const defaultChapter = initialMetadata.chapters?.find((chapter) => chapter?.id);
            const canonicalPages = appMode === 'manga'
                ? (activeChapter?.pages || [])
                : (initialMetadata.plannedPages || []);
            const hydratedPages = hydratePlannedPages(canonicalPages);
            // Keep the in-progress story when a sibling project update arrives without
            // the canonical story source (for example, immediately after analysis).
            // Clearing it here makes the next Plan Thumbnails request fail with the
            // misleading "Please enter your story text" validation error.
            const incomingStory = initialMetadata.series?.storySource || initialMetadata.story || initialMetadata.chapters?.find((chapter) => chapter?.id)?.storySource || '';
            setFullStory((previousStory) => incomingStory || previousStory);
            setStoryBible(initialMetadata.series?.storyBible || null);
            setStoryBibleText(initialMetadata.series?.storyBible ? JSON.stringify(initialMetadata.series.storyBible, null, 2) : '');
            setMangaBrief(initialMetadata.mangaBrief?.text || '');
            if (!activeChapterId && defaultChapter?.id) setActiveChapterId(defaultChapter.id);
            setPlannedPages(hydratedPages);
            setGenerationQueue(initialMetadata.generationQueue || { items: [], state: 'idle' });
            setPageSettings(buildPageSettingsMap(hydratedPages));

            const restoredResults = {};
            hydratedPages.forEach((page, idx) => {
                if (page.generatedAsset) {
                    restoredResults[idx] = { success: true, result: page.generatedAsset };
                }
            });
            setGeneratedResults(restoredResults);
        }
    }, [initialMetadata, isLocalUpdate, activeChapterId, appMode]);

    const activeChapter = initialMetadata?.chapters?.find((chapter) => chapter.id === activeChapterId);

    const handleCreateChapter = async () => {
        try {
            const response = await createChapter(projectId, { title: `Chapter ${(initialMetadata?.chapters?.length || 0) + 1}` });
            setActiveChapterId(response.chapter.id);
            if (response.project?.id) onProjectUpdate?.(response.project);
            setStatusMessage(`${response.chapter.title} created.`);
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Chapter Creation Failed', type: 'error' });
        }
    };

    useEffect(() => {
        setDefaultSettings({ ...fallbackDefaults, ...(aiDefaults || {}) });
    }, [aiDefaults]);

    useEffect(() => {
        if (plannedPages.length > 0) {
            const newSettings = {};
            plannedPages.forEach((page, idx) => {
                if (!pageSettings[idx]) {
                    newSettings[idx] = getPageGenerationSettings(page, defaultSettings);
                }
            });
            if (Object.keys(newSettings).length > 0) {
                setPageSettings((prev) => ({ ...prev, ...newSettings }));
            }
        }
    }, [defaultSettings, pageSettings, plannedPages]);

    const refreshGenerationHistory = async () => {
        if (!projectId) return;
        try {
            setGenerationHistory(await getGenerationHistory(projectId));
        } catch (error) {
            console.error('Failed to load generation history:', error);
        }
    };

    useEffect(() => {
        refreshGenerationHistory();
    }, [projectId]);

    useEffect(() => {
        if (appMode !== 'manga' || !projectId || !generationQueue?.id || !['queued', 'running'].includes(generationQueue.state)) return undefined;
        const timer = window.setInterval(async () => {
            try {
                const latest = await getProject(projectId);
                const job = latest.generationQueue;
                setGenerationQueue(job);
                onProjectUpdate?.(latest);
                if (job.state === 'completed' || job.state === 'failed') setBatchProgress(null);
            } catch (error) {
                console.error('Failed to poll generation job:', error);
            }
        }, 2000);
        return () => window.clearInterval(timer);
    }, [appMode, generationQueue?.id, generationQueue?.state, projectId]);

    const saveProjectState = async (story, pages, extraPatch = {}) => {
        if (!projectId) return;
        setIsLocalUpdate(true);
        const buildPayload = (projectSnapshot, expectedRevision) => ({
            ...extraPatch,
            ...(appMode === 'manga' && activeChapter ? {
                series: { ...projectSnapshot.series, storySource: story },
                chapters: projectSnapshot.chapters.map((chapter) => chapter.id === activeChapter.id
                    ? { ...chapter, storySource: story, pages: clearInlineGeneratedResults(pages) } : chapter),
                expectedRevision,
            } : {
                story,
                plannedPages: clearInlineGeneratedResults(pages),
            }),
        });
        try {
            const updatedProject = await updateProject(projectId, buildPayload(initialMetadata, initialMetadata.revision));
            onProjectUpdate?.(updatedProject);
            return updatedProject;
        } catch (err) {
            if (err.status === 409) {
                try {
                    // Background generation may have advanced the revision between
                    // the read and this save. Rebase the exact user edit once onto
                    // the latest project instead of surfacing a spurious failure.
                    const latestProject = await getProject(projectId);
                    const rebasedProject = await updateProject(projectId, buildPayload(latestProject, latestProject.revision));
                    onProjectUpdate?.(rebasedProject);
                    return rebasedProject;
                } catch (retryError) {
                    console.error('Failed to rebase project save after revision conflict:', retryError);
                }
            }
            console.error('Failed to save project state:', err);
            setStatusMessage(err.message);
            onNotify?.({ message: err.message, title: 'Project Save Failed', type: 'error' });
            throw err;
        } finally {
            setIsLocalUpdate(false);
        }
    };

    const persistGenerationQueue = async (queue) => {
        setGenerationQueue(queue);
        await saveProjectState(fullStory, plannedPages, { generationQueue: queue });
    };

    const handleParseStory = async () => {
        if (!fullStory.trim()) {
            setStatusMessage('Please enter your story text.');
            return;
        }

        setIsPlanning(true);
        setGeneratedResults({});
        setPageSettings({});
        setStatusMessage('');
        try {
            const assetList = [
                ...library.characters.map((character) => `[Character] ${character.displayName || character.name} (${character.name}) ${character.role || ''} ${character.usage || ''} ${character.notes || ''}`.trim()),
                ...library.locations.map((location) => `[Location] ${location.displayName || location.name} (${location.name}) ${location.role || ''} ${location.usage || ''} ${location.notes || ''}`.trim()),
                ...library.style.map((style) => `[Style] ${style.displayName || style.name} (${style.name}) ${style.role || ''} ${style.usage || ''} ${style.notes || ''}`.trim()),
            ];

            const data = await requestPlanStory({
                story: fullStory,
                assetList,
                appMode,
                projectId,
                chapterId: activeChapter?.id,
                mangaBrief,
                storyBible,
                targetPageCount: targetPageCount > 0 ? targetPageCount : null,
            });

            if (onUsageUpdate) onUsageUpdate(data.route, data.usage);

            const pages = hydratePlannedPages(Array.isArray(data) ? data : data.pages || []);
            setPlannedPages(pages);
            setPageSettings(buildPageSettingsMap(pages));
            // Manga planning is persisted by /api/plan using the current revision.
            // Do not immediately issue a second write with the stale revision that
            // was present when this component rendered.
            if (data.project) {
                onProjectUpdate?.(data.project);
            } else {
                await saveProjectState(fullStory, pages);
            }
            await refreshGenerationHistory();
        } catch (err) {
            setStatusMessage(err.message);
            onNotify?.({ message: err.message, title: 'Planning Failed', type: 'error' });
        } finally {
            setIsPlanning(false);
        }
    };

    const handleAnalyzeStory = async () => {
        if (!fullStory.trim()) {
            setStatusMessage('Please enter your story text.');
            return;
        }
        setIsAnalyzingStory(true);
        setStatusMessage('');
        try {
            const data = await requestAnalyzeStory({
                projectId,
                chapterId: activeChapter?.id,
                storySource: fullStory,
                mangaBrief,
            });
            setStoryBible(data.storyBible);
            setStoryBibleText(JSON.stringify(data.storyBible, null, 2));
            onProjectUpdate?.(data.project);
            if (onUsageUpdate) onUsageUpdate(data.route, data.usage);
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Story Analysis Failed', type: 'error' });
        } finally {
            setIsAnalyzingStory(false);
        }
    };

    const handleBriefBlur = async () => {
        if (!projectId || !mangaBrief.trim()) return;
        try {
            const updated = await updateProject(projectId, {
                mangaBrief: {
                    ...(initialMetadata?.mangaBrief || { presetId: 'japanese-manga', version: 1 }),
                    text: mangaBrief,
                    version: (initialMetadata?.mangaBrief?.version || 0) + 1,
                },
            });
            onProjectUpdate?.(updated);
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Brief Save Failed', type: 'error' });
        }
    };

    const handleStoryBibleBlur = async () => {
        if (!projectId || !storyBibleText.trim()) return;
        try {
            const editedBible = JSON.parse(storyBibleText);
            const version = (storyBible?.version || 0) + 1;
            const updated = await updateProject(projectId, {
                expectedRevision: initialMetadata.revision,
                series: { ...initialMetadata.series, storyBible: { ...editedBible, version } },
                chapters: (initialMetadata.chapters || []).map((chapter) => ({ ...chapter, storyBibleVersion: version, status: chapter.status === 'approved' ? 'planned' : chapter.status })),
            });
            const nextBible = updated.series.storyBible;
            setStoryBible(nextBible);
            setStoryBibleText(JSON.stringify(nextBible, null, 2));
            onProjectUpdate?.(updated);
            setStatusMessage('Story Bible saved as a new continuity version.');
        } catch (error) {
            setStatusMessage(error instanceof SyntaxError ? 'Story Bible must be valid JSON.' : error.message);
            onNotify?.({ message: error.message, title: 'Story Bible Save Failed', type: 'error' });
        }
    };

    const handleApprovePlan = async () => {
        const chapterId = activeChapter?.id;
        if (!chapterId) return;
        try {
            const updated = await approveChapterPlan(chapterId, { projectId, pageIds: plannedPages.map((page) => page.id) });
            onProjectUpdate?.(updated);
            setPlannedPages(hydratePlannedPages(updated.chapters?.find((chapter) => chapter.id === chapterId)?.pages || plannedPages));
            setStatusMessage('Page and panel thumbnails approved. Art generation is enabled.');
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Plan Approval Failed', type: 'error' });
        }
    };

    const getReferencesForPage = (page) => {
        const refs = [];
        [...library.characters, ...library.locations, ...library.style].forEach((item) => {
            const matchTerms = [item.name, item.displayName, item.role].filter(Boolean);
            const suggestedReferences = Array.isArray(page.suggestedReferences) ? page.suggestedReferences : [];
            if (suggestedReferences.some((ref) => matchTerms.some((term) => String(ref).includes(term)))) {
                refs.push(item);
            }
        });
        return refs;
    };

    const updatePageSetting = (pageIndex, setting, value) => {
        const nextSettings = {
            ...getPageGenerationSettings(plannedPages[pageIndex], defaultSettings),
            ...(pageSettings[pageIndex] || {}),
            [setting]: value,
        };

        setPageSettings((prev) => ({
            ...prev,
            [pageIndex]: nextSettings,
        }));
        setPlannedPages((prevPages) => {
            const newPages = mergePageAtIndex(prevPages, pageIndex, { generationSettings: nextSettings });
            saveProjectState(fullStory, newPages).catch(() => {});
            return newPages;
        });
    };

    const updatePageContent = (pageIndex, newContent) => {
        setPlannedPages((prevPages) => mergePageAtIndex(prevPages, pageIndex, { pageContent: newContent }));
    };

    const handleContentBlur = (pageIndex, newContent) => {
        setPlannedPages((prevPages) => {
            const newPages = mergePageAtIndex(prevPages, pageIndex, { pageContent: newContent });
            saveProjectState(fullStory, newPages).catch(() => {});
            return newPages;
        });
    };

    const applyDefaultsToAll = () => {
        const newPages = plannedPages.map((page) => ({
            ...page,
            generationSettings: { ...defaultSettings },
        }));
        setPageSettings(buildPageSettingsMap(newPages));
        setPlannedPages(newPages);
        saveProjectState(fullStory, newPages).catch(() => {});
    };

    const persistGeneratedImage = async (pageIndex, imageSource) => {
        const { dataUrl } = await inlineImageToSavePayload(imageSource);
        const { asset } = await saveAsset({
            bucket: 'pages',
            imageData: dataUrl,
            pageIndex,
            projectId,
        });
        return asset;
    };

    const generatePage = async (pageIndex, page) => {
        const settings = pageSettings[pageIndex] || getPageGenerationSettings(page, defaultSettings);
        setGeneratingPages((prev) => ({ ...prev, [pageIndex]: true }));
        setStatusMessage('');

        try {
            if (appMode === 'manga' && page.panels?.length > 0) {
                const chapterId = activeChapter?.id;
                if (!chapterId || page.approval !== 'approved' || page.panels.some((panel) => panel.approval !== 'approved')) {
                    throw new Error('Approve this page and its panel thumbnails before generating art.');
                }
                const renderedPanels = [];
                for (const panel of page.panels) {
                    const panelResponse = await generatePersistedPanel(chapterId, page.id, panel.id, {
                        projectId,
                        colorMode: settings.colorMode,
                        textDensity: settings.textDensity,
                        aspectRatio: settings.aspectRatio,
                    });
                    renderedPanels.push(panelResponse.panel);
                    if (onUsageUpdate) onUsageUpdate(panelResponse.route, panelResponse.usage);
                }
                const nextPage = { ...page, panels: renderedPanels };
                setPlannedPages((prevPages) => mergePageAtIndex(prevPages, pageIndex, nextPage));
                setGeneratedResults((prev) => ({ ...prev, [pageIndex]: { success: true, result: null } }));
                await refreshGenerationHistory();
                return { success: true };
            }
            const matchedRefs = getReferencesForPage(page);
            const referenceImages = await fetchAssetsAsReferences(matchedRefs);
            const data = await requestGeneratePage({
                prompt: page.pageContent,
                references: referenceImages,
                panels: page.panelCount || 3,
                mode: settings.genMode,
                projectId,
                colorMode: settings.colorMode,
                textDensity: settings.textDensity,
                appMode,
                aspectRatio: settings.aspectRatio,
                artStyle: settings.artStyle,
            });

            if (onUsageUpdate) {
                onUsageUpdate(data.route, data.usage);
            }

            const resultObj = { success: true, result: data.result };
            setGeneratedResults((prev) => ({
                ...prev,
                [pageIndex]: resultObj,
            }));

            if (data.result?.type === 'image') {
                const generatedAsset = await persistGeneratedImage(pageIndex, data.result);
                setPlannedPages((prevPages) => {
                    const newPages = updatePageGeneratedAsset(prevPages, pageIndex, generatedAsset);
                    saveProjectState(fullStory, newPages).catch(() => {});
                    return newPages;
                });
            }
            await refreshGenerationHistory();
            return { success: true };
        } catch (err) {
            setGeneratedResults((prev) => ({
                ...prev,
                [pageIndex]: { success: false, error: err.message },
            }));
            setStatusMessage(err.message);
            onNotify?.({ message: err.message, title: 'Page Generation Failed', type: 'error' });
            return { success: false, error: err.message };
        } finally {
            setGeneratingPages((prev) => ({ ...prev, [pageIndex]: false }));
        }
    };

    const updatePanelQualityReview = async (pageIndex, panel, qualityReview) => {
        if (!activeChapter?.id || !panel?.id) return;
        try {
            const response = await updatePersistedPanel(activeChapter.id, plannedPages[pageIndex].id, panel.id, {
                projectId,
                panel: { qualityReview },
            });
            setPlannedPages((previousPages) => mergePageAtIndex(previousPages, pageIndex, {
                panels: previousPages[pageIndex].panels.map((candidate) => candidate.id === panel.id ? response.panel : candidate),
            }));
            onProjectUpdate?.(response.project);
            setStatusMessage(qualityReview === 'accepted' ? `Panel ${panel.order} accepted.` : `Panel ${panel.order} marked for regeneration.`);
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Panel Review Failed', type: 'error' });
        }
    };

    const regeneratePanel = async (pageIndex, panel) => {
        if (!activeChapter?.id || !panel?.id || generatingPanels[panel.id]) return;
        const page = plannedPages[pageIndex];
        const settings = pageSettings[pageIndex] || getPageGenerationSettings(page, defaultSettings);
        setGeneratingPanels((previous) => ({ ...previous, [panel.id]: true }));
        try {
            const response = await generatePersistedPanel(activeChapter.id, page.id, panel.id, {
                projectId,
                colorMode: settings.colorMode,
                textDensity: settings.textDensity,
                aspectRatio: settings.aspectRatio,
            });
            const regeneratedPanel = {
                ...response.panel,
                // A successful replacement must always return to human review;
                // never let the previous rejected state linger in local React
                // state while the persisted project is already pending.
                qualityReview: 'pending',
                renderStatus: 'succeeded',
            };
            setPlannedPages((previousPages) => mergePageAtIndex(previousPages, pageIndex, {
                panels: previousPages[pageIndex].panels.map((candidate) => candidate.id === panel.id ? regeneratedPanel : candidate),
            }));
            // Clear any page-level error left by the failed attempt that led
            // to this retry. The persisted panel card is now the source of
            // truth and should not be obscured by stale transient state.
            setGeneratedResults((previousResults) => ({
                ...previousResults,
                [pageIndex]: { success: true, result: null },
            }));
            if (response.project?.id) onProjectUpdate?.(response.project);
            if (onUsageUpdate) onUsageUpdate(response.route, response.usage);
            await refreshGenerationHistory();
            setStatusMessage(`Panel ${panel.order} regenerated and saved for review.`);
        } catch (error) {
            const failedPanel = {
                ...panel,
                renderStatus: 'failed',
                renderError: {
                    code: error.code || 'PANEL_GENERATION_FAILED',
                    message: error.message || 'Panel regeneration failed',
                },
            };
            setPlannedPages((previousPages) => mergePageAtIndex(previousPages, pageIndex, {
                panels: previousPages[pageIndex].panels.map((candidate) => candidate.id === panel.id ? failedPanel : candidate),
            }));
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Panel Regeneration Failed', type: 'error' });
        } finally {
            setGeneratingPanels((previous) => ({ ...previous, [panel.id]: false }));
        }
    };

    const handleBatchGenerate = async () => {
        if (plannedPages.length === 0) return;

        if (appMode === 'manga' && activeChapter?.id) {
            try {
                const response = await startGenerationJob(projectId, { chapterId: activeChapter.id, pageIds: plannedPages.map((page) => page.id) });
                setGenerationQueue(response.job);
                setBatchProgress({ current: 0, total: response.job.items.length });
                onProjectUpdate?.(response.project);
                setStatusMessage('Server generation job started. It will resume after restart.');
            } catch (error) {
                setStatusMessage(error.message);
                onNotify?.({ message: error.message, title: 'Generation Job Failed', type: 'error' });
            }
            return;
        }

        const startedAt = new Date().toISOString();
        const initialQueue = {
            items: plannedPages.map((_, pageIndex) => ({ pageIndex, status: 'queued', updatedAt: startedAt, error: '' })),
            state: 'running',
            updatedAt: startedAt,
        };
        await persistGenerationQueue(initialQueue);
        setBatchProgress({ current: 0, total: plannedPages.length });

        for (let i = 0; i < plannedPages.length; i++) {
            const runningQueue = {
                ...initialQueue,
                items: initialQueue.items.map((item) => (
                    item.pageIndex === i ? { ...item, status: 'running', updatedAt: new Date().toISOString() } : item
                )),
                updatedAt: new Date().toISOString(),
            };
            setGenerationQueue(runningQueue);
            setBatchProgress({ current: i + 1, total: plannedPages.length });
            const latestResult = await generatePage(i, plannedPages[i]);
            initialQueue.items[i] = {
                pageIndex: i,
                status: latestResult?.success === false ? 'failed' : 'succeeded',
                updatedAt: new Date().toISOString(),
                error: latestResult?.error || '',
            };
            await persistGenerationQueue({ ...initialQueue, updatedAt: new Date().toISOString() });
        }

        await persistGenerationQueue({ ...initialQueue, state: 'completed', updatedAt: new Date().toISOString() });
        setBatchProgress(null);
    };

    const toggleExpanded = (idx) => {
        setExpandedPages(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const handleSendToCreatorWithResult = (page, pageIndex) => {
        const resultEntry = generatedResults[pageIndex];
        const currentResult = getPersistedOrTransientResult(page, resultEntry);
        const parsedResult = parseStoryboardResult(resultEntry?.result);

        onSendToCreator({
            ...page,
            chapterId: activeChapter?.id,
            pageId: page.id,
            generationSettings: getPageGenerationSettings(page, defaultSettings),
            pageIndex,
            generatedAsset: page.generatedAsset || null,
            generatedResult: parsedResult || currentResult,
        });
    };

    const handleEditPage = async (pageIndex) => {
        const imageSource = getPersistedOrTransientResult(plannedPages[pageIndex], generatedResults[pageIndex]);
        if (!imageSource) {
            return;
        }

        try {
            const imageDataUrl = await toInlineImageDataUrl(imageSource);
            setEditingImageData(imageDataUrl);
            setEditingPageIndex(pageIndex);
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Editor Unavailable', type: 'error' });
        }
    };

    const handleSaveEdit = async (editedResult) => {
        if (editingPageIndex === null) return;

        try {
            const generatedAsset = await persistGeneratedImage(editingPageIndex, editedResult);
            setGeneratedResults((prev) => ({
                ...prev,
                [editingPageIndex]: { success: true, result: editedResult },
            }));

            setPlannedPages((prevPages) => {
                const newPages = updatePageGeneratedAsset(prevPages, editingPageIndex, generatedAsset);
                saveProjectState(fullStory, newPages).catch(() => {});
                return newPages;
            });
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Edit Save Failed', type: 'error' });
        } finally {
            setEditingPageIndex(null);
            setEditingImageData(null);
        }
    };

    const handleCloseEditor = () => {
        setEditingPageIndex(null);
        setEditingImageData(null);
    };

    const handlePageImageUpload = (pageIndex, event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            try {
                const dataUrl = loadEvent.target.result;
                const uploadedResult = {
                    type: 'image',
                    data: dataUrl.split(',')[1],
                    mimeType: file.type || 'image/png',
                };
                const generatedAsset = await persistGeneratedImage(pageIndex, uploadedResult);

                setGeneratedResults((prev) => ({
                    ...prev,
                    [pageIndex]: { success: true, result: uploadedResult },
                }));
                setPlannedPages((prevPages) => {
                    const newPages = updatePageGeneratedAsset(prevPages, pageIndex, generatedAsset);
                    saveProjectState(fullStory, newPages).catch(() => {});
                    return newPages;
                });
            } catch (error) {
                setStatusMessage(error.message);
                onNotify?.({ message: error.message, title: 'Upload Failed', type: 'error' });
            }
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const renderGeneratedPreview = (pageIndex, page) => {
        const resultEntry = generatedResults[pageIndex];
        const currentResult = getPersistedOrTransientResult(page, resultEntry);

        if (resultEntry && !resultEntry.success) {
            return (
                <div className="generation-error">
                    <span>Warning</span> {resultEntry.error}
                </div>
            );
        }

        if (!currentResult) return null;

        const imageSrc = getDisplayImageSrc(currentResult);
        if (imageSrc) {
            return (
                <div className="generated-preview">
                    <img src={imageSrc} alt="Generated page" />
                    <div className="preview-badge">Saved Preview</div>
                </div>
            );
        }

        const parsedResult = parseStoryboardResult(resultEntry?.result);
        if (parsedResult?.panels) {
            return (
                <div className="storyboard-preview">
                    <div className="preview-badge storyboard">Storyboard Ready</div>
                    <div className="mini-panels">
                        {parsedResult.panels.slice(0, 4).map((panel, index) => (
                            <div key={index} className="mini-panel">
                                <span className="mini-panel-num">{panel.panelNumber}</span>
                            </div>
                        ))}
                        {parsedResult.panels.length > 4 && (
                            <div className="mini-panel more">+{parsedResult.panels.length - 4}</div>
                        )}
                    </div>
                </div>
            );
        }

        return null;
    };

    const completedCount = plannedPages.filter((page, index) => (
        appMode === 'manga' && page.panels?.length > 0
            ? page.panels.every((panel) => panel.generatedAsset && panel.renderStatus === 'succeeded')
            : Boolean(getPersistedOrTransientResult(page, generatedResults[index]))
    )).length;
    const planApproved = appMode === 'storybook' || (plannedPages.length > 0 && plannedPages.every((page) => page.approval === 'approved'));

    return (
        <div className="planner-layout animate-in">
            {/* Left Sidebar - Input */}
            <aside className="planner-sidebar">
                <div className="sidebar-section">
                    <h2 className="heading-font sidebar-title">
                        <span className="title-icon">TXT</span>
                        Story Parser
                    </h2>
                    <p className="sidebar-desc">
                        {appMode === 'storybook'
                            ? 'Paste your story. AI will break it into illustration sections, each with a single evocative image.'
                            : 'Paste your script or story. AI will break it into manga pages with individual generation settings.'}
                    </p>
                </div>

                <StatusMessage message={statusMessage} tone="error" />

                <div className="field-group">
                    <label className="field-label">Story Script</label>
                    <textarea
                        className="input-glass story-input"
                        placeholder="Once upon a time in a digital world..."
                        value={fullStory}
                        onChange={(e) => setFullStory(e.target.value)}
                    />
                </div>

                {appMode === 'manga' && (initialMetadata?.chapters || []).length > 0 && (
                    <div className="field-group">
                        <label className="field-label">Chapter</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select className="input-glass" value={activeChapter?.id || ''} onChange={(event) => setActiveChapterId(event.target.value)}>
                                {(initialMetadata.chapters || []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.number}. {chapter.title}</option>)}
                            </select>
                            <button type="button" className="btn-secondary" onClick={handleCreateChapter}>+ Chapter</button>
                        </div>
                    </div>
                )}

                {appMode === 'manga' && (
                    <div className="field-group">
                        <label className="field-label">Manga Production Brief</label>
                        <textarea
                            className="input-glass"
                            value={mangaBrief}
                            onChange={(e) => setMangaBrief(e.target.value)}
                            onBlur={handleBriefBlur}
                            placeholder="Describe reading direction, continuity, lettering space, and visual rules..."
                            style={{ minHeight: '150px', fontSize: '0.82rem' }}
                        />
                        <span className="input-hint">Applied to story analysis, thumbnails, and panel art.</span>
                    </div>
                )}

                <StatusMessage message={statusMessage} tone="error" />

                <div className="field-group">
                    <label className="field-label">Target Pages (0 for Auto)</label>
                    <div className="input-with-hint">
                        <input
                            type="number"
                            min="0"
                            max="50"
                            className="input-glass"
                            value={targetPageCount}
                            onChange={(e) => setTargetPageCount(parseInt(e.target.value) || 0)}
                        />
                        {targetPageCount === 0 && <span className="input-hint">Auto-detect</span>}
                    </div>
                </div>

                <button
                    onClick={handleAnalyzeStory}
                    disabled={isAnalyzingStory || isPlanning || appMode === 'storybook'}
                    className="btn-secondary"
                    style={{ width: '100%', marginBottom: '8px' }}
                >
                    {isAnalyzingStory ? 'Analyzing Story Bible...' : 'Analyze Story'}
                </button>

                {appMode === 'manga' && storyBible && (
                    <div className="generation-history-panel" style={{ marginBottom: '12px' }}>
                        <div className="generation-history-title">Story Bible v{storyBible.version}</div>
                        <small>{storyBible.characters?.length || 0} characters · {storyBible.locations?.length || 0} locations · {storyBible.continuityRules?.length || 0} continuity rules</small>
                        <textarea className="input-glass" value={storyBibleText} onChange={(event) => setStoryBibleText(event.target.value)} onBlur={handleStoryBibleBlur} rows={8} style={{ marginTop: '8px', width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }} aria-label="Editable Story Bible" />
                    </div>
                )}

                <button
                    onClick={handleParseStory}
                    disabled={isPlanning || (appMode === 'manga' && !storyBible)}
                    className="btn-primary"
                >
                    {isPlanning ? (
                        <><span className="btn-loader"></span> Analyzing...</>
                    ) : (
                        'Plan Thumbnails'
                    )}
                </button>

                {plannedPages.length > 0 && (
                    <>
                        {/* Generation Settings Section */}
                        <div className="sidebar-settings-section">
                            <div className="settings-section-header">
                                <span className="settings-section-icon">CFG</span>
                                <span className="settings-section-title">Generation Settings</span>
                            </div>

                            <div className="settings-card">
                                <div className="settings-card-header">Output</div>
                                <div className="settings-grid">
                                    {appMode !== 'storybook' && (
                                        <div className="field-group compact">
                                            <label className="field-label">Mode</label>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.genMode}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, genMode: e.target.value }))}
                                            >
                                                <option value="storyboard">Storyboard</option>
                                                <option value="full">Full Page Art</option>
                                            </select>
                                        </div>
                                    )}

                                    <div className="field-group compact">
                                        <label className="field-label">Color</label>
                                        <select
                                            className="input-glass"
                                            value={defaultSettings.colorMode}
                                            onChange={(e) => setDefaultSettings(prev => ({ ...prev, colorMode: e.target.value }))}
                                        >
                                            <option value="bw">Black & White</option>
                                            <option value="color">Full Color</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-card">
                                <div className="settings-card-header">Layout & Size</div>
                                <div className="settings-grid">
                                    <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                        <label className="field-label">Aspect Ratio</label>
                                        <select
                                            className="input-glass"
                                            value={['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(defaultSettings.aspectRatio) ? defaultSettings.aspectRatio : 'custom'}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'custom') setDefaultSettings(prev => ({ ...prev, aspectRatio: '' }));
                                                else setDefaultSettings(prev => ({ ...prev, aspectRatio: val }));
                                            }}
                                        >
                                            <option value="portrait">Standard Manga (2:3)</option>
                                            <option value="landscape">Landscape (3:2)</option>
                                            <option value="square">Square (1:1)</option>
                                            <option value="3:4">Book Portrait (3:4)</option>
                                            <option value="cinematic">Cinematic (16:9)</option>
                                            <option value="custom">Custom / Resolution...</option>
                                        </select>
                                    </div>
                                    {!['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(defaultSettings.aspectRatio) && (
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <input
                                                type="text"
                                                className="input-glass"
                                                placeholder="e.g. 1024x1024 or 21:9"
                                                value={defaultSettings.aspectRatio}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, aspectRatio: e.target.value }))}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Storybook-specific: Art Style */}
                            {appMode === 'storybook' && (
                                <div className="settings-card mode-specific storybook">
                                    <div className="settings-card-header">
                                        <span>Style</span> Art Style
                                    </div>
                                    <div className="settings-grid">
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.artStyle}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, artStyle: e.target.value }))}
                                            >
                                                <option value="storybook_classic">Classic Storybook</option>
                                                <option value="watercolor">Watercolor</option>
                                                <option value="oil_painting">Oil Painting</option>
                                                <option value="digital_illustration">Digital Illustration</option>
                                                <option value="anime">Anime</option>
                                                <option value="realistic">Realistic</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Manga-specific: Text Density */}
                            {appMode !== 'storybook' && (
                                <div className="settings-card mode-specific manga">
                                    <div className="settings-card-header">
                                        <span>Text</span> Text & Dialogue
                                    </div>
                                    <div className="settings-grid">
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <label className="field-label">Text Density</label>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.textDensity}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, textDensity: e.target.value }))}
                                            >
                                                <option value="minimal">Minimal (clean panels)</option>
                                                <option value="dialog">Dialog Only</option>
                                                <option value="dialog_fx">Dialog & Sound FX</option>
                                                <option value="dialog_fx_narration">Dialog, FX & Narration</option>
                                                <option value="full">Full Detail</option>
                                            </select>
                                            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.35 }}>
                                                Dialogue and SFX are saved as editable overlays; generated panel art stays clean.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={applyDefaultsToAll}
                                className="btn-secondary"
                            >
                                Apply to All Pages
                            </button>
                        </div>

                        {/* Generate Section */}
                        <div className="sidebar-generate-section">
                            <button
                                onClick={handleBatchGenerate}
                                disabled={batchProgress !== null || plannedPages.length === 0 || (appMode === 'manga' && !planApproved)}
                                className="btn-batch"
                                title={appMode === 'manga' && !planApproved ? 'Approve all page and panel thumbnails before generating art' : undefined}
                            >
                                {batchProgress ? (
                                    <>
                                        <span className="btn-loader"></span>
                                        Generating {batchProgress.current}/{batchProgress.total}...
                                    </>
                                ) : (
                                    <>Generate All Pages</>
                                )}
                            </button>
                            {appMode === 'manga' && !planApproved && (
                                <small className="input-hint" style={{ display: 'block', marginTop: '8px' }}>
                                    Approve the page and panel thumbnails before generating art.
                                </small>
                            )}

                            {(completedCount > 0 || batchProgress) && (
                                <div className="batch-status">
                                    <div className="status-bar">
                                        <div
                                            className="status-fill"
                                            style={{ width: `${(completedCount / plannedPages.length) * 100}%` }}
                                        />
                                    </div>
                                    <span className="status-text">
                                        {completedCount}/{plannedPages.length} pages complete
                                    </span>
                                </div>
                            )}
                            {generationQueue?.items?.length > 0 && (
                                <div className="queue-status">
                                    <strong>Batch Queue: {generationQueue.state}</strong>
                                    <span>
                                        {generationQueue.items.filter((item) => item.status === 'succeeded').length} succeeded /{' '}
                                        {generationQueue.items.filter((item) => item.status === 'failed').length} failed
                                    </span>
                                    {generationQueue.id && generationQueue.state === 'failed' && (
                                        <button type="button" className="btn-secondary" onClick={async () => {
                                            const response = await resumeGenerationJob(projectId, generationQueue.id);
                                            setGenerationQueue(response.job);
                                            setBatchProgress({ current: response.job.nextIndex || 0, total: response.job.items.length });
                                        }}>Resume Job</button>
                                    )}
                                </div>
                            )}
                            {generationHistory.length > 0 && (
                                <div className="generation-history-panel">
                                    <div className="generation-history-title">Recent AI Runs</div>
                                    {generationHistory.slice(0, 5).map((entry) => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            className="generation-history-item"
                                            onClick={() => onNotify?.({
                                                message: `${entry.route?.provider || 'route'}:${entry.route?.model || entry.route?.routeKey || 'configured'} / ${entry.resultType || 'result'} / ${(entry.references || []).length} refs`,
                                                title: entry.operation,
                                                type: 'info',
                                            })}
                                        >
                                            <span>{entry.operation}</span>
                                            <small>{new Date(entry.timestamp).toLocaleString()}</small>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </aside>

            {/* Main Content - Results */}
            <main className="planner-content">
                {plannedPages.length === 0 && !isPlanning && (
                    <div className="empty-state glass-panel">
                        <div className="empty-icon">[]</div>
                        <h3>No Pages Planned Yet</h3>
                        <p>Enter your story on the left and click "Plan Thumbnails" to begin.</p>
                    </div>
                )}

                {isPlanning && (
                    <div className="empty-state glass-panel">
                        <div className="loader"></div>
                        <p style={{ marginTop: '15px' }}>Constructing Storyboards...</p>
                    </div>
                )}

                {plannedPages.length > 0 && (
                    <div className="pages-container">
                        <div className="pages-header">
                            <h3 className="section-title">
                                Planned Sequence
                                <span className="page-count">{plannedPages.length} Pages</span>
                            </h3>
                            {appMode === 'manga' && (
                                <button className="btn-secondary" onClick={handleApprovePlan} disabled={planApproved || plannedPages.length === 0}>
                                    {planApproved ? 'Plan Approved' : 'Approve Thumbnails'}
                                </button>
                            )}
                        </div>

                        <div className="pages-grid">
                            {plannedPages.map((page, idx) => {
                                const matchedRefs = getReferencesForPage(page);
                                const isGenerating = generatingPages[idx];
                                const hasResult = generatedResults[idx];
                                const isExpanded = expandedPages[idx];
                                const settings = pageSettings[idx] || getPageGenerationSettings(page, defaultSettings);

                                return (
                                    <div
                                        key={idx}
                                        className={`page-card animate-in ${appMode === 'manga' ? 'manga-page-card' : ''} ${hasResult?.success ? 'completed' : ''} ${isGenerating ? 'generating' : ''} ${isExpanded ? 'expanded-view' : ''}`}
                                        style={{ animationDelay: `${idx * 0.05}s` }}
                                    >
                                        <div className="page-header" onClick={() => toggleExpanded(idx)}>
                                            <div className="page-number">
                                                {page.pageNumber || idx + 1}
                                            </div>
                                            <div className="page-meta">
                                                <span className="panel-count">{appMode === 'storybook' ? 'Illustration' : `${page.panelCount} Panels`}</span>
                                                {getPersistedOrTransientResult(page, hasResult) && <span className="status-dot success">+</span>}
                                                {hasResult && !hasResult.success && <span className="status-dot error">!</span>}
                                            </div>
                                            <button className="expand-btn">
                                                {isExpanded ? 'v' : '>'}
                                            </button>
                                        </div>

                                        {/* Per-Page Generation Settings */}
                                        <div className="page-settings">
                                            {appMode !== 'storybook' && (
                                                <select
                                                    className="page-setting-select"
                                                    value={settings.genMode}
                                                    onChange={(e) => updatePageSetting(idx, 'genMode', e.target.value)}
                                                    title="Generation Mode"
                                                >
                                                    <option value="storyboard">Storyboard</option>
                                                    <option value="full">Full Art</option>
                                                </select>
                                            )}
                                            <select
                                                className="page-setting-select"
                                                value={settings.colorMode}
                                                onChange={(e) => updatePageSetting(idx, 'colorMode', e.target.value)}
                                                title="Color Mode"
                                            >
                                                <option value="bw">B&W</option>
                                                <option value="color">Color</option>
                                            </select>
                                            <select
                                                className="page-setting-select"
                                                value={['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(settings.aspectRatio) ? settings.aspectRatio : 'custom'}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val === 'custom') updatePageSetting(idx, 'aspectRatio', '');
                                                    else updatePageSetting(idx, 'aspectRatio', val);
                                                }}
                                                title="Aspect Ratio"
                                            >
                                                <option value="portrait">Portrait (2:3)</option>
                                                <option value="landscape">Landscape (3:2)</option>
                                                <option value="square">Square (1:1)</option>
                                                <option value="3:4">Book (3:4)</option>
                                                <option value="cinematic">Cinematic (16:9)</option>
                                                <option value="custom">Custom...</option>
                                            </select>

                                            {appMode === 'storybook' ? (
                                                <>
                                                    <select
                                                        className="page-setting-select"
                                                        value={settings.artStyle}
                                                        onChange={(e) => updatePageSetting(idx, 'artStyle', e.target.value)}
                                                        title="Art Style"
                                                    >
                                                        <option value="storybook_classic">Classic</option>
                                                        <option value="watercolor">Watercolor</option>
                                                        <option value="oil_painting">Oil Painting</option>
                                                        <option value="digital_illustration">Digital</option>
                                                        <option value="anime">Anime</option>
                                                        <option value="realistic">Realistic</option>
                                                    </select>
                                                </>
                                            ) : (
                                                <select
                                                    className="page-setting-select"
                                                    value={settings.textDensity}
                                                    onChange={(e) => updatePageSetting(idx, 'textDensity', e.target.value)}
                                                    title="Text Density"
                                                >
                                                    <option value="minimal">Minimal</option>
                                                    <option value="dialog">Dialog</option>
                                                    <option value="dialog_fx">Dialog + FX</option>
                                                    <option value="dialog_fx_narration">Dialog + FX + Narration</option>
                                                    <option value="full">Full</option>
                                                </select>
                                            )}
                                        </div>
                                        {!['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(settings.aspectRatio) && (
                                            <div className="page-settings" style={{ marginTop: '5px' }}>
                                                <input
                                                    type="text"
                                                    className="input-glass"
                                                    style={{ height: '25px', fontSize: '0.8rem' }}
                                                    placeholder="Custom Resolution (e.g. 1024x1024)"
                                                    value={settings.aspectRatio}
                                                    onChange={(e) => updatePageSetting(idx, 'aspectRatio', e.target.value)}
                                                />
                                            </div>
                                        )}

                                        {/* Reference Thumbnails */}
                                        {matchedRefs.length > 0 && (
                                            <div className="ref-thumbnails">
                                                {matchedRefs.filter(r => r.type === 'image').slice(0, 4).map((ref, i) => (
                                                    <img
                                                        key={i}
                                                        src={ref.url}
                                                        alt={ref.name}
                                                        title={ref.name}
                                                    />
                                                ))}
                                                {matchedRefs.length > 4 && (
                                                    <div className="ref-more">+{matchedRefs.length - 4}</div>
                                                )}
                                            </div>
                                        )}

                                        {/* Generated Preview */}
                                        {renderGeneratedPreview(idx, page)}

                                        {appMode === 'manga' && page.panels?.length > 0 && (
                                            <div className="storyboard-preview" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px' }}>
                                                {page.panels.map((panel, panelIndex) => (
                                                    <div key={panel.id || panelIndex} className={`mini-panel ${panel.renderStatus === 'failed' ? 'panel-render-failed' : ''}`} title={panel.renderStatus === 'failed' ? (panel.renderError?.message || 'Panel render failed') : undefined} style={{ minHeight: '110px', padding: '8px', background: panel.generatedAsset ? '#111827' : 'rgba(255,255,255,0.04)' }}>
                                                        {panel.generatedAsset && getDisplayImageSrc(panel.generatedAsset) ? <img src={getDisplayImageSrc(panel.generatedAsset)} alt={`Panel ${panel.order}`} style={{ width: '100%', height: 'auto', aspectRatio: '2 / 3', objectFit: 'cover' }} /> : <span className="mini-panel-num">{panel.order}</span>}
                                                        <small style={{ display: 'block', marginTop: '6px' }}>{panel.shotType} · thumbnail {panel.approval}</small>
                                                        {panel.renderStatus === 'succeeded' && panel.qualityReview === 'accepted' && <small className="panel-quality-badge panel-quality-accepted">Quality accepted</small>}
                                                        {panel.renderStatus === 'succeeded' && panel.qualityReview === 'pending' && <small className="panel-review-badge">AI output · review</small>}
                                                        {panel.renderStatus === 'failed' && <small className="panel-regeneration-badge">Generation failed</small>}
                                                        {panel.renderStatus === 'succeeded' && panel.qualityReview === 'rejected' && <small className="panel-regeneration-badge">Needs regeneration</small>}
                                                        {(panel.renderStatus === 'failed' || (panel.renderStatus === 'succeeded' && panel.qualityReview === 'rejected')) && (
                                                            <div className="panel-review-actions">
                                                                <button type="button" onClick={() => regeneratePanel(idx, panel)} disabled={generatingPanels[panel.id]}>
                                                                    {generatingPanels[panel.id] ? 'Drawing…' : 'Regenerate'}
                                                                </button>
                                                            </div>
                                                        )}
                                                        {panel.renderStatus === 'succeeded' && panel.qualityReview === 'pending' && (
                                                            <div className="panel-review-actions">
                                                                <button type="button" onClick={() => updatePanelQualityReview(idx, panel, 'accepted')}>Accept</button>
                                                                <button type="button" onClick={() => updatePanelQualityReview(idx, panel, 'rejected')}>Needs regen</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Expandable Content */}
                                        <div className={`page-content ${isExpanded ? 'expanded' : ''}`}>
                                            <textarea
                                                className="content-text-editable input-glass"
                                                value={page.pageContent}
                                                onChange={(e) => updatePageContent(idx, e.target.value)}
                                                onBlur={(e) => handleContentBlur(idx, e.target.value)}
                                                placeholder="Enter prompt or story text..."
                                                style={{ width: '100%', minHeight: '80px', background: 'rgba(255,255,255,0.05)', border: 'none', resize: 'vertical' }}
                                            />

                                            {Array.isArray(page.suggestedReferences) && page.suggestedReferences.length > 0 && (
                                                <div className="ref-tags">
                                                    {page.suggestedReferences.map((ref, i) => (
                                                        <span key={i} className="ref-tag">Ref: {ref}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="page-actions">
                                            <button
                                                className="action-btn generate"
                                                onClick={() => generatePage(idx, page)}
                                                disabled={isGenerating || batchProgress !== null || !planApproved}
                                            >
                                                {isGenerating ? (
                                                    <><span className="btn-loader small"></span> Generating...</>
                                                ) : hasResult?.success ? (
                                                    'Regenerate'
                                                ) : (
                                                    'Generate'
                                                )}
                                            </button>
                                            {getDisplayImageSrc(getPersistedOrTransientResult(page, hasResult)) && (
                                                <button
                                                    className="action-btn edit"
                                                    onClick={() => handleEditPage(idx)}
                                                    title="Edit this image"
                                                >
                                                    Edit
                                                </button>
                                            )}
                                            <button
                                                className="action-btn upload"
                                                onClick={() => pageUploadRefs.current[idx]?.click()}
                                                title="Upload an image instead of generating"
                                            >
                                                Upload
                                            </button>
                                            <input
                                                ref={el => pageUploadRefs.current[idx] = el}
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handlePageImageUpload(idx, e)}
                                                style={{ display: 'none' }}
                                            />
                                            <button
                                                className="action-btn send"
                                                onClick={() => handleSendToCreatorWithResult(page, idx)}
                                            >
                                                Open in Creator
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* Image Editor Modal */}
            <ImageEditorModal
                isOpen={editingPageIndex !== null}
                onClose={handleCloseEditor}
                imageData={editingImageData}
                onSaveEdit={handleSaveEdit}
                projectId={projectId}
                onNotify={onNotify}
            />
        </div >
    );
};

export default PlannerView;
