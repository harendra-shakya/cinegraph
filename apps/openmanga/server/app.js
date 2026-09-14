const path = require('path');
const express = require('express');
const { getConfig } = require('./config');
const { AppError, isAppError } = require('./errors');
const { createAiSettingsStore } = require('./services/ai-settings-store');
const { createAiService } = require('./services/ai-service');
const { createAssetStore } = require('./services/asset-store');
const { createGenerationHistoryStore } = require('./services/generation-history-store');
const { createProjectStore } = require('./services/project-store');
const { createProjectPortability } = require('./services/project-portability');
const { assertGlobalBucket, assertProjectBucket, assertValidProjectId } = require('./services/validation');
const { createChapter, normalizeStoryBible } = require('./services/story-first');

const isAllowedLocalOrigin = (originValue) => {
    if (!originValue) {
        return true;
    }

    try {
        const parsed = new URL(originValue);
        return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    } catch (error) {
        return false;
    }
};

const localOnlyMiddleware = (req, res, next) => {
    if (!isAllowedLocalOrigin(req.headers.origin)) {
        return res.status(403).json({ error: 'Local access only' });
    }

    next();
};

const resolveChapter = (project, chapterId) => {
    if (chapterId) return project.chapters.find((chapter) => chapter.id === chapterId) || null;
    if (project.chapters.length === 1) return project.chapters.at(0);
    throw new AppError(400, 'chapterId is required when the project contains multiple chapters');
};

const createApp = ({ appRoot, rootDir } = {}) => {
    const baseConfig = getConfig(appRoot);
    const config = {
        ...baseConfig,
        ...(rootDir ? { rootDir } : {}),
    };
    const aiSettingsStore = createAiSettingsStore({ config });
    const assetStore = createAssetStore({ rootDir: config.rootDir });
    const generationHistoryStore = createGenerationHistoryStore({ rootDir: config.rootDir });
    const projectStore = createProjectStore({ assetStore, rootDir: config.rootDir });
    const projectPortability = createProjectPortability({ projectStore, rootDir: config.rootDir });
    const aiService = createAiService({ aiSettingsStore });
    const activeJobs = new Map();

    const persistPanelGeneration = async ({ project, chapter, page, panel }) => {
        const panelIndex = page.panels.findIndex((item) => item.id === panel.id);
        const library = await assetStore.listLibrary(project.id);
        const requestedReferences = [...(panel.characters || []), panel.location, ...(panel.props || [])].filter(Boolean).map((value) => String(value).toLowerCase());
        const referenceAssets = [...(library.characters || []), ...(library.locations || []), ...(library.style || [])]
            .filter((asset) => requestedReferences.some((value) => [asset.name, asset.displayName, asset.role].filter(Boolean).some((field) => String(field).toLowerCase().includes(value))))
            .map((asset) => ({ bucket: asset.bucket, name: asset.name, displayName: asset.displayName, url: asset.url, role: asset.role }));
        const continuityPanel = [...page.panels.slice(0, panelIndex)].reverse().find((candidate) => candidate.qualityReview === 'accepted' && candidate.generatedAsset)
            || page.panels[panelIndex - 1];
        const previousPanelAsset = continuityPanel?.generatedAsset;
        const previousPanelReference = previousPanelAsset?.filename
            ? await assetStore.readAssetAsDataUrl({ projectId: project.id, bucket: previousPanelAsset.bucket || 'pages', filename: previousPanelAsset.filename })
            : null;
        const continuityReferenceAsset = previousPanelAsset?.filename
            ? { bucket: previousPanelAsset.bucket || 'pages', name: previousPanelAsset.filename, displayName: 'Previous panel continuity reference', url: previousPanelAsset.url || '', role: 'continuity-reference' }
            : null;
        const resolvedReferenceAssets = [...referenceAssets, continuityReferenceAsset].filter(Boolean);
        const referenceImages = (await Promise.all([
            ...referenceAssets.map((asset) => assetStore.readAssetAsDataUrl(asset)),
            previousPanelReference,
        ])).filter(Boolean);
        const response = await aiService.generatePanel({
            panel,
            projectId: project.id,
            colorMode: 'bw',
            textDensity: 'minimal',
            aspectRatio: 'portrait',
            userInstruction: '',
            continuityContext: {
                mangaBrief: project.mangaBrief.text,
                storyBible: project.series.storyBible,
                readingDirection: project.series.readingDirection,
                chapter,
                page,
                previousPanel: page.panels[panelIndex - 1] || null,
                panel,
                references: resolvedReferenceAssets,
            },
            references: referenceImages,
        });
        const generationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const dataUrl = `data:${response.result.mimeType};base64,${response.result.data}`;
        const asset = await assetStore.saveAsset({ bucket: 'pages', imageData: dataUrl, filename: `chapter-${chapter.number}-page-${page.pageNumber}-panel-${panel.order}-${generationId}.jpg`, projectId: project.id });
        const revision = {
            id: generationId,
            generatedAsset: asset,
            provider: response.route.provider,
            model: response.route.model,
            promptVersion: 'manga-v1',
            briefVersion: project.mangaBrief.version,
            storyBibleVersion: chapter.storyBibleVersion,
            createdAt: new Date().toISOString(),
        };
        const nextChapters = project.chapters.map((item) => item.id === chapter.id ? {
            ...item,
            status: 'in-progress',
            pages: item.pages.map((candidatePage) => candidatePage.id === page.id ? {
                ...candidatePage,
                panels: candidatePage.panels.map((candidatePanel) => candidatePanel.id === panel.id ? {
                    ...candidatePanel,
                    generatedAsset: asset,
                    generationId,
                    renderStatus: 'succeeded',
                    qualityReview: 'pending',
                    renderError: null,
                    revisions: [...(candidatePanel.revisions || []), revision],
                } : candidatePanel),
            } : candidatePage),
        } : item);
        const updatedProject = await projectStore.updateProject(project.id, { chapters: nextChapters });
        await generationHistoryStore.appendHistory(project.id, { operation: 'generate-panel', prompt: panel.composition, resultType: 'image', route: response.route, settings: { chapterId: chapter.id, pageId: page.id, panelId: panel.id, promptVersion: 'manga-v1', storyBibleVersion: chapter.storyBibleVersion }, usage: response.usage });
        return { updatedProject, response };
    };

    const updateJobQueue = async (projectId, job) => {
        const nextJob = { ...job, updatedAt: new Date().toISOString() };
        console.info('[mangagen.job]', JSON.stringify({ projectId, jobId: nextJob.id, state: nextJob.state, nextIndex: nextJob.nextIndex, items: nextJob.items?.length || 0 }));
        return projectStore.updateProject(projectId, { generationQueue: nextJob });
    };

    const runGenerationJob = async (projectId, job) => {
        if (activeJobs.has(job.id)) return;
        activeJobs.set(job.id, true);
        let currentJob = job;
        try {
            currentJob = { ...currentJob, state: 'running' };
            await updateJobQueue(projectId, currentJob);
            for (let index = currentJob.nextIndex || 0; index < currentJob.items.length; index += 1) {
                const project = await projectStore.getProject(projectId);
                const item = currentJob.items[index];
                const chapter = project.chapters.find((candidate) => candidate.id === item.chapterId);
                const page = chapter?.pages.find((candidate) => candidate.id === item.pageId);
                const panel = page?.panels.find((candidate) => candidate.id === item.panelId);
                if (!chapter || !page || !panel) throw new AppError(404, 'Job panel no longer exists');
                if (page.approval !== 'approved' || panel.approval !== 'approved' || page.approvedPlanRevision !== page.planRevision) throw new AppError(409, 'Job panel approval is stale');
                try {
                    await persistPanelGeneration({ project, chapter, page, panel });
                    currentJob = { ...currentJob, nextIndex: index + 1, items: currentJob.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, status: 'succeeded', error: '', errorCode: '' } : candidate) };
                } catch (error) {
                    currentJob = { ...currentJob, nextIndex: index, items: currentJob.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, status: 'failed', error: error.message, errorCode: error.code || 'GENERATION_PANEL_FAILED' } : candidate) };
                    await projectStore.updateProject(projectId, {
                        chapters: project.chapters.map((candidateChapter) => candidateChapter.id === chapter.id ? {
                            ...candidateChapter,
                            pages: candidateChapter.pages.map((candidatePage) => candidatePage.id === page.id ? {
                                ...candidatePage,
                                panels: candidatePage.panels.map((candidatePanel) => candidatePanel.id === panel.id ? {
                                    ...candidatePanel,
                                    renderStatus: 'failed',
                                    renderError: { code: error.code || 'PANEL_GENERATION_FAILED', message: error.message || 'Panel generation failed', provider: error.provider || null, model: error.model || null, attempt: error.attempt || null, createdAt: new Date().toISOString() },
                                } : candidatePanel),
                            } : candidatePage),
                        } : candidateChapter),
                    });
                    throw error;
                }
                await updateJobQueue(projectId, currentJob);
            }
            currentJob = { ...currentJob, state: 'completed' };
            await updateJobQueue(projectId, currentJob);
        } catch (error) {
            currentJob = { ...currentJob, state: 'failed', error: error.message, errorCode: error.code || 'GENERATION_JOB_FAILED', updatedAt: new Date().toISOString() };
            await updateJobQueue(projectId, currentJob).catch(() => {});
        } finally {
            activeJobs.delete(job.id);
        }
    };

    assetStore.ensureBaseDirs().catch((error) => {
        console.error('Failed to ensure base directories:', error);
    });

    const app = express();
    app.use(localOnlyMiddleware);
    app.use('/api', (req, res, next) => {
        const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        res.setHeader('X-Request-Id', requestId);
        req.requestId = requestId;
        next();
    });
    app.post('/api/projects/import', express.raw({ limit: '500mb', type: ['application/zip', 'application/octet-stream'] }), async (req, res, next) => {
        try {
            res.status(201).json(await projectPortability.importProject(req.body));
        } catch (error) {
            next(error);
        }
    });
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ extended: true, limit: '100mb' }));

    app.use('/library/:bucket', (req, res, next) => {
        try {
            const bucket = assertGlobalBucket(req.params.bucket);
            return express.static(assetStore.getGlobalBucketDir(bucket))(req, res, next);
        } catch (error) {
            return next(error);
        }
    });

    app.use('/projects/:projectId/:bucket', (req, res, next) => {
        try {
            const projectId = assertValidProjectId(req.params.projectId);
            const bucket = assertProjectBucket(req.params.bucket);
            return express.static(assetStore.getProjectBucketDir(projectId, bucket))(req, res, next);
        } catch (error) {
            return next(error);
        }
    });

    app.get('/api/projects', async (req, res, next) => {
        try {
            res.json(await projectStore.listProjects());
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/projects', async (req, res, next) => {
        try {
            const project = await projectStore.createProject(req.body || {});
            res.status(201).json(project);
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id', async (req, res, next) => {
        try {
            res.json(await projectStore.getProject(req.params.id));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id/export', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.params.id);
            const zipBuffer = await projectPortability.exportProject(req.params.id);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${project.id}.mangagen.zip"`);
            res.send(zipBuffer);
        } catch (error) {
            next(error);
        }
    });

    app.put('/api/projects/:id', async (req, res, next) => {
        try {
            res.json(await projectStore.updateProject(req.params.id, req.body || {}));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/projects/:id/chapters', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.params.id);
            const number = project.chapters.reduce((highest, chapter) => Math.max(highest, chapter.number || 0), 0) + 1;
            const chapter = createChapter({ number, title: req.body?.title, storySource: req.body?.storySource || '' });
            const updatedProject = await projectStore.updateProject(project.id, {
                expectedRevision: project.revision,
                chapters: [...project.chapters, chapter],
            });
            res.status(201).json({ chapter, project: updatedProject });
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/projects/:id/generation-jobs', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.params.id);
            if (project.generationQueue?.id && ['queued', 'running'].includes(project.generationQueue.state)) throw new AppError(409, 'A generation job is already active for this project');
            const maxActiveJobs = Number(process.env.MANGAGEN_MAX_ACTIVE_JOBS) || 2;
            if (activeJobs.size >= maxActiveJobs) throw new AppError(429, 'Generation capacity is full; retry when an active job completes');
            const chapter = resolveChapter(project, req.body?.chapterId);
            if (!chapter) throw new AppError(404, 'Chapter not found');
            const requestedPageIds = Array.isArray(req.body?.pageIds) && req.body.pageIds.length ? req.body.pageIds : chapter.pages.map((page) => page.id);
            const items = chapter.pages
                .filter((page) => requestedPageIds.includes(page.id))
                .flatMap((page) => page.panels.map((panel) => ({ chapterId: chapter.id, pageId: page.id, panelId: panel.id, status: 'queued', error: '', updatedAt: new Date().toISOString() })));
            if (!items.length) throw new AppError(400, 'No panels selected for generation');
            if (items.some((item) => {
                const page = chapter.pages.find((candidate) => candidate.id === item.pageId);
                const panel = page.panels.find((candidate) => candidate.id === item.panelId);
                return page.approval !== 'approved' || panel.approval !== 'approved' || page.approvedPlanRevision !== page.planRevision;
            })) throw new AppError(409, 'All job panels must be approved against the current plan revision');
            const job = { id: `job-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'panel', nextIndex: 0, items, state: 'queued', updatedAt: new Date().toISOString() };
            const updatedProject = await projectStore.updateProject(project.id, { expectedRevision: project.revision, generationQueue: job });
            void runGenerationJob(project.id, job);
            res.status(202).json({ job, project: updatedProject });
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/projects/:id/generation-jobs/:jobId/resume', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.params.id);
            const job = project.generationQueue;
            if (!job || job.id !== req.params.jobId) throw new AppError(404, 'Generation job not found');
            if (job.state === 'completed') return res.json({ job, project });
            void runGenerationJob(project.id, { ...job, state: 'queued' });
            res.status(202).json({ job: { ...job, state: 'queued' }, project });
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/library', async (req, res, next) => {
        try {
            res.json(await assetStore.listLibrary(req.query.projectId || null));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/settings/ai', async (req, res, next) => {
        try {
            res.json(await aiSettingsStore.getPublicSettings());
        } catch (error) {
            next(error);
        }
    });

    app.put('/api/settings/ai', async (req, res, next) => {
        try {
            res.json(await aiSettingsStore.updateSettings(req.body || {}));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id/generation-history', async (req, res, next) => {
        try {
            res.json(await generationHistoryStore.listHistory(req.params.id));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/generate', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.generate(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'generate-page',
                prompt: payload.prompt,
                references: (payload.references || []).map((reference) => reference.name),
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    appMode: payload.appMode,
                    artStyle: payload.artStyle,
                    aspectRatio: payload.aspectRatio,
                    colorMode: payload.colorMode,
                    mode: payload.mode,
                    panels: payload.panels,
                    textDensity: payload.textDensity,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/generate-panel', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.generatePanel(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'generate-panel',
                prompt: payload.panel?.composition,
                references: (payload.references || []).map((reference) => reference.name),
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    aspectRatio: payload.aspectRatio,
                    colorMode: payload.colorMode,
                    textDensity: payload.textDensity,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/plan', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const project = payload.projectId ? await projectStore.getProject(payload.projectId) : null;
            let updatedProject = null;
            const response = await aiService.planStory({
                ...payload,
                mangaBrief: payload.mangaBrief || project?.mangaBrief?.text,
                storyBible: payload.storyBible || project?.series?.storyBible,
            });
            if (project && payload.appMode === 'manga') {
                const chapter = resolveChapter(project, payload.chapterId);
                if (!chapter) throw new AppError(404, 'Chapter not found');
                const chapterId = chapter.id;
                const storySource = typeof payload.story === 'string' && payload.story.trim()
                    ? payload.story
                    : chapter.storySource || project.series.storySource || '';
                updatedProject = await projectStore.updateProject(project.id, {
                    expectedRevision: project.revision,
                    series: { ...project.series, storySource },
                    chapters: project.chapters.map((chapter) => chapter.id === chapterId
                        ? { ...chapter, storySource, status: 'planned', pages: response.pages }
                        : chapter),
                });
            }
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'plan-story',
                prompt: payload.story,
                references: payload.assetList || [],
                resultType: 'json',
                route: response.route,
                settings: {
                    appMode: payload.appMode,
                    targetPageCount: payload.targetPageCount,
                },
                usage: response.usage,
            });
            res.json({ ...response, project: updatedProject });
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/analyze-story', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const project = await projectStore.getProject(payload.projectId);
            const chapter = resolveChapter(project, payload.chapterId);
            if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

            const storySource = typeof payload.storySource === 'string' ? payload.storySource : chapter.storySource || project.series.storySource;
            const response = await aiService.analyzeStory({ storySource, mangaBrief: payload.mangaBrief || project.mangaBrief.text });
            const storyBible = normalizeStoryBible({ ...response.storyBible, version: (project.series.storyBible.version || 0) + 1 });
            const updatedProject = await projectStore.updateProject(project.id, {
                expectedRevision: project.revision,
                mangaBrief: { ...project.mangaBrief, text: payload.mangaBrief || project.mangaBrief.text },
                series: { ...project.series, storySource, storyBible },
                chapters: project.chapters.map((item) => item.id === chapter.id
                    ? { ...item, storySource, storyVersion: (item.storyVersion || 0) + 1, storyBibleVersion: storyBible.version }
                    : item),
            });
            await generationHistoryStore.appendHistory(project.id, {
                operation: 'analyze-story',
                prompt: storySource,
                resultType: 'story-bible',
                route: response.route,
                settings: { storyBibleVersion: storyBible.version },
                usage: response.usage,
            });
            res.json({ storyBible, storyVersion: chapter.storyVersion + 1, storyBibleVersion: storyBible.version, warnings: [], route: response.route, usage: response.usage, project: updatedProject });
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/chapters/:chapterId/approve-plan', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.body?.projectId);
            const chapter = project.chapters.find((item) => item.id === req.params.chapterId);
            if (!chapter) throw new AppError(404, 'Chapter not found');
            const requestedPageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds : chapter.pages.map((page) => page.id);
            const nextChapters = project.chapters.map((item) => item.id === chapter.id ? {
                ...item,
                status: requestedPageIds.length === chapter.pages.length ? 'approved' : 'planned',
                pages: item.pages.map((page) => requestedPageIds.includes(page.id) ? {
                    ...page,
                    approval: 'approved',
                    approvedPlanRevision: page.planRevision,
                    panels: page.panels.map((panel) => ({ ...panel, approval: 'approved' })),
                } : page),
            } : item);
            res.json(await projectStore.updateProject(project.id, { chapters: nextChapters }));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/chapters/:chapterId/pages/:pageId/panels/:panelId/generate', async (req, res, next) => {
        let project;
        let chapter;
        let page;
        let panel;
        let generationAttempted = false;
        try {
            project = await projectStore.getProject(req.body?.projectId);
            chapter = project.chapters.find((item) => item.id === req.params.chapterId);
            page = chapter?.pages.find((item) => item.id === req.params.pageId);
            panel = page?.panels.find((item) => item.id === req.params.panelId);
            if (!chapter || !page || !panel) throw new AppError(404, 'Chapter, page, or panel not found');
            if (page.approval !== 'approved' || panel.approval !== 'approved' || page.approvedPlanRevision !== page.planRevision) {
                throw new AppError(409, 'Approve the current page and panel plan before generating panel art');
            }

            const panelIndex = page.panels.findIndex((item) => item.id === panel.id);
            const library = await assetStore.listLibrary(project.id);
            const requestedReferences = [...(panel.characters || []), panel.location, ...(panel.props || [])].filter(Boolean).map((value) => String(value).toLowerCase());
            const referenceAssets = [...(library.characters || []), ...(library.locations || []), ...(library.style || [])]
                .filter((asset) => requestedReferences.some((value) => [asset.name, asset.displayName, asset.role].filter(Boolean).some((field) => String(field).toLowerCase().includes(value))))
                .map((asset) => ({ bucket: asset.bucket, name: asset.name, displayName: asset.displayName, url: asset.url, role: asset.role }));
        const continuityPanel = [...page.panels.slice(0, panelIndex)].reverse().find((candidate) => candidate.qualityReview === 'accepted' && candidate.generatedAsset)
            || page.panels[panelIndex - 1];
        const previousPanelAsset = continuityPanel?.generatedAsset;
            const previousPanelReference = previousPanelAsset?.filename
                ? await assetStore.readAssetAsDataUrl({ projectId: project.id, bucket: previousPanelAsset.bucket || 'pages', filename: previousPanelAsset.filename })
                : null;
            const continuityReferenceAsset = previousPanelAsset?.filename
                ? { bucket: previousPanelAsset.bucket || 'pages', name: previousPanelAsset.filename, displayName: 'Previous panel continuity reference', url: previousPanelAsset.url || '', role: 'continuity-reference' }
                : null;
            const resolvedReferenceAssets = [...referenceAssets, continuityReferenceAsset].filter(Boolean);
            const referenceImages = (await Promise.all([
                ...referenceAssets.map((asset) => assetStore.readAssetAsDataUrl(asset)),
                previousPanelReference,
            ])).filter(Boolean);
            generationAttempted = true;
            const response = await aiService.generatePanel({
                panel,
                projectId: project.id,
                colorMode: req.body?.colorMode || 'bw',
                textDensity: req.body?.textDensity || 'minimal',
                aspectRatio: req.body?.aspectRatio || 'portrait',
                userInstruction: req.body?.userInstruction || '',
                continuityContext: {
                    mangaBrief: project.mangaBrief.text,
                    storyBible: project.series.storyBible,
                    readingDirection: project.series.readingDirection,
                    chapter,
                    page,
                    previousPanel: page.panels[panelIndex - 1] || null,
                    panel,
                    references: resolvedReferenceAssets,
                },
                references: referenceImages,
            });
            const generationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const dataUrl = `data:${response.result.mimeType};base64,${response.result.data}`;
            const asset = await assetStore.saveAsset({ bucket: 'pages', imageData: dataUrl, filename: `chapter-${chapter.number}-page-${page.pageNumber}-panel-${panel.order}-${generationId}.jpg`, projectId: project.id });
            const revision = {
                id: generationId,
                generatedAsset: asset,
                provider: response.route.provider,
                model: response.route.model,
                promptVersion: 'manga-v2',
                briefVersion: project.mangaBrief.version,
                storyBibleVersion: chapter.storyBibleVersion,
                qualityReview: 'pending',
                createdAt: new Date().toISOString(),
            };
            const nextChapters = project.chapters.map((item) => item.id === chapter.id ? {
                ...item,
                status: 'in-progress',
                pages: item.pages.map((candidatePage) => candidatePage.id === page.id ? {
                    ...candidatePage,
                    panels: candidatePage.panels.map((candidatePanel) => candidatePanel.id === panel.id ? {
                        ...candidatePanel,
                        generatedAsset: asset,
                        generationId,
                        renderStatus: 'succeeded',
                        qualityReview: 'pending',
                        renderError: null,
                        revisions: [...(candidatePanel.revisions || []), revision],
                    } : candidatePanel),
                } : candidatePage),
            } : item);
            const updatedProject = await projectStore.updateProject(project.id, { chapters: nextChapters });
            await generationHistoryStore.appendHistory(project.id, { operation: 'generate-panel', prompt: panel.composition, resultType: 'image', route: response.route, settings: { chapterId: chapter.id, pageId: page.id, panelId: panel.id, promptVersion: 'manga-v2', storyBibleVersion: chapter.storyBibleVersion }, usage: response.usage });
            const updatedPanel = updatedProject.chapters.find((item) => item.id === chapter.id).pages.find((candidatePage) => candidatePage.id === page.id).panels.find((candidatePanel) => candidatePanel.id === panel.id);
            res.json({ ...response, panel: updatedPanel, project: updatedProject });
        } catch (error) {
            if (generationAttempted && project && chapter && page && panel) {
                const failedPanel = {
                    ...panel,
                    renderStatus: 'failed',
                    renderError: {
                        code: error.code || 'PANEL_GENERATION_FAILED',
                        message: error.message || 'Panel generation failed',
                        provider: error.provider || null,
                        model: error.model || null,
                        attempt: error.attempt || null,
                        createdAt: new Date().toISOString(),
                    },
                };
                await projectStore.updateProject(project.id, {
                    chapters: project.chapters.map((item) => item.id === chapter.id ? {
                        ...item,
                        pages: item.pages.map((candidatePage) => candidatePage.id === page.id ? {
                            ...candidatePage,
                            panels: candidatePage.panels.map((candidatePanel) => candidatePanel.id === panel.id ? failedPanel : candidatePanel),
                        } : candidatePage),
                    } : item),
                });
            }
            next(error);
        }
    });

    app.patch('/api/chapters/:chapterId/pages/:pageId/panels/:panelId', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.body?.projectId);
            const chapter = project.chapters.find((item) => item.id === req.params.chapterId);
            const page = chapter?.pages.find((item) => item.id === req.params.pageId);
            const panel = page?.panels.find((item) => item.id === req.params.panelId);
            if (!chapter || !page || !panel) throw new AppError(404, 'Chapter, page, or panel not found');
            const allowed = ['dialogue', 'soundEffects', 'lettering', 'approval', 'userInstruction', 'qualityReview'];
            const patch = Object.fromEntries(Object.entries(req.body?.panel || {}).filter(([key]) => allowed.includes(key)));
            if (Object.prototype.hasOwnProperty.call(patch, 'qualityReview')
                && !['pending', 'accepted', 'rejected'].includes(patch.qualityReview)) {
                throw new AppError(400, 'Invalid panel quality review state');
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'qualityReview')
                && (!panel.generatedAsset || panel.renderStatus !== 'succeeded')) {
                throw new AppError(409, 'Panel quality review requires a successfully rendered panel');
            }
            // Lettering is an editable overlay rendered outside the clean art. Updating
            // it must not invalidate the approved art plan or block panel regeneration.
            const planFieldsChanged = Object.prototype.hasOwnProperty.call(patch, 'userInstruction');
            const updatedProject = await projectStore.updateProject(project.id, {
                chapters: project.chapters.map((item) => item.id === chapter.id ? {
                    ...item,
                    pages: item.pages.map((candidatePage) => candidatePage.id === page.id ? {
                        ...candidatePage,
                        approval: planFieldsChanged ? 'draft' : candidatePage.approval,
                        approvedPlanRevision: planFieldsChanged ? '' : candidatePage.approvedPlanRevision,
                        panels: candidatePage.panels.map((candidatePanel) => candidatePanel.id === panel.id ? { ...candidatePanel, ...patch, approval: planFieldsChanged ? 'draft' : candidatePanel.approval } : candidatePanel),
                    } : candidatePage),
                } : item),
            });
            const updatedPanel = updatedProject.chapters.find((item) => item.id === chapter.id).pages.find((item) => item.id === page.id).panels.find((item) => item.id === panel.id);
            res.json({ panel: updatedPanel, project: updatedProject });
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/edit', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.editImage(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'edit-image',
                prompt: payload.prompt,
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    mode: payload.mode,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/save', async (req, res, next) => {
        try {
            const asset = await assetStore.saveAsset(req.body || {});
            res.json({ asset });
        } catch (error) {
            next(error);
        }
    });

    // Recover queued work after a server restart. Jobs are intentionally stored in
    // the project record, so the worker can resume from nextIndex without relying
    // on a browser tab remaining open.
    void projectStore.listProjects().then((projects) => Promise.all(projects
        .filter((project) => project.generationQueue?.state === 'running' || project.generationQueue?.state === 'queued')
        .map((project) => runGenerationJob(project.id, project.generationQueue))))
        .catch((error) => console.error('Failed to resume generation jobs:', error));

    if (process.env.NODE_ENV === 'production') {
        const distDir = path.join(config.appRoot, 'dist');
        app.use(express.static(distDir));
        app.get(/.*/, (req, res) => {
            res.sendFile(path.join(distDir, 'index.html'));
        });
    }

    app.use((error, req, res, next) => {
        if (isAppError(error)) {
            return res.status(error.status).json({ error: error.message });
        }

        console.error('Unhandled server error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    });

    return app;
};

module.exports = {
    createApp,
};
