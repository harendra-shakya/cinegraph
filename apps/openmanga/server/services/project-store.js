const path = require('path');
const { SCHEMA_VERSION } = require('../constants');
const { AppError } = require('../errors');
const { listDirectories, pathExists, readJson, writeJson } = require('./storage');
const { assertProjectBucket, assertSafeFilename, assertValidProjectId, slugifyProjectName } = require('./validation');
const { migrateProjectToV3, normalizeProjectV3 } = require('./story-first');

const createProjectStore = ({ assetStore, rootDir }) => {
    const projectsDir = path.join(rootDir, 'projects');
    const projectLocks = new Map();

    const withProjectLock = (projectId, operation) => {
        const previous = projectLocks.get(projectId) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        projectLocks.set(projectId, current);
        return current.finally(() => {
            if (projectLocks.get(projectId) === current) projectLocks.delete(projectId);
        });
    };

    const getProjectPath = (projectId) => path.join(projectsDir, assertValidProjectId(projectId));
    const getProjectConfigPath = (projectId) => path.join(getProjectPath(projectId), 'project.json');

    const normalizeAssetReference = (asset) => {
        if (!asset) {
            return null;
        }

        return {
            bucket: assertProjectBucket(asset.bucket),
            filename: assertSafeFilename(asset.filename),
            mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : 'image/png',
            updatedAt: typeof asset.updatedAt === 'string'
                ? asset.updatedAt
                : new Date().toISOString(),
        };
    };

    const hydrateAssetReference = (projectId, asset) => {
        if (!asset) {
            return null;
        }

        return assetStore.buildAssetRecord({
            bucket: asset.bucket,
            filename: asset.filename,
            mimeType: asset.mimeType,
            projectId,
            updatedAt: asset.updatedAt,
        });
    };

    const normalizeBookletCover = (cover) => {
        const normalizedCover = { ...(cover || {}) };

        if (cover?.generatedAsset) {
            normalizedCover.generatedAsset = normalizeAssetReference(cover.generatedAsset);
        } else {
            delete normalizedCover.generatedAsset;
        }

        return normalizedCover;
    };

    const normalizeStorybookBooklet = (booklet) => ({
        covers: {
            front: normalizeBookletCover(booklet?.covers?.front),
            back: normalizeBookletCover(booklet?.covers?.back),
        },
    });

    const normalizeGenerationQueue = (queue) => ({
        id: typeof queue?.id === 'string' ? queue.id : null,
        kind: queue?.kind === 'panel' ? 'panel' : 'page',
        nextIndex: Number.isInteger(queue?.nextIndex) && queue.nextIndex >= 0 ? queue.nextIndex : 0,
        items: Array.isArray(queue?.items)
            ? queue.items.map((item) => ({
                chapterId: typeof item?.chapterId === 'string' ? item.chapterId : null,
                pageId: typeof item?.pageId === 'string' ? item.pageId : null,
                panelId: typeof item?.panelId === 'string' ? item.panelId : null,
                errorCode: typeof item?.errorCode === 'string' ? item.errorCode : '',
                error: typeof item?.error === 'string' ? item.error : '',
                pageIndex: Number.isInteger(item?.pageIndex) ? item.pageIndex : 0,
                status: ['queued', 'running', 'succeeded', 'failed', 'skipped'].includes(item?.status)
                    ? item.status
                    : 'queued',
                updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
            }))
            : [],
        state: ['idle', 'queued', 'running', 'paused', 'completed', 'failed'].includes(queue?.state) ? queue.state : 'idle',
        errorCode: typeof queue?.errorCode === 'string' ? queue.errorCode : '',
        error: typeof queue?.error === 'string' ? queue.error : '',
        updatedAt: typeof queue?.updatedAt === 'string' ? queue.updatedAt : new Date().toISOString(),
    });

    const hydrateStorybookBooklet = (projectId, booklet) => {
        const normalizedBooklet = normalizeStorybookBooklet(booklet);

        return {
            ...normalizedBooklet,
            covers: {
                front: normalizedBooklet.covers.front.generatedAsset
                    ? {
                        ...normalizedBooklet.covers.front,
                        generatedAsset: hydrateAssetReference(projectId, normalizedBooklet.covers.front.generatedAsset),
                    }
                    : normalizedBooklet.covers.front,
                back: normalizedBooklet.covers.back.generatedAsset
                    ? {
                        ...normalizedBooklet.covers.back,
                        generatedAsset: hydrateAssetReference(projectId, normalizedBooklet.covers.back.generatedAsset),
                    }
                    : normalizedBooklet.covers.back,
            },
        };
    };

    const normalizePlannedPages = (pages) => (
        Array.isArray(pages)
            ? pages.map((page) => {
                const normalizedPage = { ...(page || {}) };
                delete normalizedPage.generatedResult;

                if (page?.generatedAsset) {
                    normalizedPage.generatedAsset = normalizeAssetReference(page.generatedAsset);
                } else {
                    delete normalizedPage.generatedAsset;
                }

                return normalizedPage;
            })
            : []
    );

    const normalizeProject = (project, fallbackId = null) => {
        const projectId = assertValidProjectId(project?.id || fallbackId);
        const migrated = migrateProjectToV3({
            ...project,
            id: projectId,
            series: project.story !== undefined
                ? { ...(project.series || {}), storySource: project.story }
                : project.series,
        });
        const normalized = normalizeProjectV3(migrated);
        const firstChapter = normalized.chapters[0];
        const compatibilityPages = normalizePlannedPages(project?.plannedPages || []);
        if (compatibilityPages.length && !(project?.chapters || []).some((chapter) => Array.isArray(chapter.pages) && chapter.pages.length)) {
            firstChapter.pages = compatibilityPages;
            firstChapter.status = 'planned';
        }

        return {
            ...normalized,
            id: projectId,
            generationQueue: normalizeGenerationQueue(normalized.generationQueue),
            plannedPages: normalizePlannedPages(compatibilityPages.length ? compatibilityPages : firstChapter.pages),
            story: normalized.series.storySource,
            storybookBooklet: normalizeStorybookBooklet(normalized.storybookBooklet),
        };
    };

    const hydrateProjectAssets = (project) => ({
        ...project,
        plannedPages: project.plannedPages.map((page) => {
            if (!page.generatedAsset) {
                return page;
            }

            return {
                ...page,
                generatedAsset: hydrateAssetReference(project.id, page.generatedAsset),
            };
        }),
        chapters: project.chapters.map((chapter) => ({
            ...chapter,
            pages: chapter.pages.map((page) => ({
                ...page,
                generatedAsset: page.generatedAsset ? hydrateAssetReference(project.id, page.generatedAsset) : null,
                panels: (Array.isArray(page.panels) ? page.panels : []).map((panel) => ({
                    ...panel,
                    generatedAsset: panel.generatedAsset ? hydrateAssetReference(project.id, panel.generatedAsset) : null,
                    revisions: (Array.isArray(panel.revisions) ? panel.revisions : []).map((revision) => ({
                        ...revision,
                        generatedAsset: revision.generatedAsset ? hydrateAssetReference(project.id, revision.generatedAsset) : null,
                    })),
                })),
            })),
        })),
        storybookBooklet: hydrateStorybookBooklet(project.id, project.storybookBooklet),
    });

    const getProject = async (projectId) => {
        const safeProjectId = assertValidProjectId(projectId);
        const filePath = getProjectConfigPath(safeProjectId);
        const rawProject = await readJson(filePath, null);

        if (!rawProject || ![2, SCHEMA_VERSION].includes(rawProject.schemaVersion)) {
            throw new AppError(404, 'Project not found');
        }
        const normalized = normalizeProject(rawProject, safeProjectId);
        if (rawProject.schemaVersion !== SCHEMA_VERSION) {
            await writeJson(filePath, normalized);
        }
        return hydrateProjectAssets(normalized);
    };

    const listProjects = async () => {
        await assetStore.ensureBaseDirs();
        const projectIds = await listDirectories(projectsDir);
        const projects = [];

        for (const projectId of projectIds) {
            try {
                const project = await getProject(projectId);
                projects.push(project);
            } catch (error) {
                if (!(error instanceof AppError)) {
                    throw error;
                }
            }
        }

        return projects.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    };

    const createProject = async ({ mode, name }) => {
        await assetStore.ensureBaseDirs();
        const projectId = slugifyProjectName(name);
        const projectPath = getProjectPath(projectId);

        if (await pathExists(projectPath)) {
            throw new AppError(400, 'Project already exists');
        }

        await assetStore.ensureProjectDirs(projectId);

        const project = normalizeProject({
            createdAt: new Date().toISOString(),
            id: projectId,
            mode,
            name: String(name || '').trim(),
            plannedPages: [],
            schemaVersion: SCHEMA_VERSION,
            story: '',
            storybookBooklet: undefined,
            mangaBrief: undefined,
            series: undefined,
            chapters: undefined,
        });

        await writeJson(getProjectConfigPath(projectId), project);
        return hydrateProjectAssets(project);
    };

    const updateProject = (projectId, patch) => withProjectLock(projectId, async () => {
        const currentProject = await getProject(projectId);
        if (patch && patch.expectedRevision !== undefined && patch.expectedRevision !== currentProject.revision) {
            throw new AppError(409, `Project revision conflict: expected ${patch.expectedRevision}, current ${currentProject.revision}`);
        }
        const nextProject = normalizeProject(
            {
                ...currentProject,
                ...patch,
                id: currentProject.id,
                schemaVersion: SCHEMA_VERSION,
                revision: currentProject.revision + 1,
            },
            currentProject.id
        );

        await writeJson(getProjectConfigPath(currentProject.id), nextProject);
        return hydrateProjectAssets(nextProject);
    });

    return {
        createProject,
        getProject,
        listProjects,
        updateProject,
    };
};

module.exports = {
    createProjectStore,
};
