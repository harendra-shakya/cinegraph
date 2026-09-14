export const mergePageAtIndex = (pages, pageIndex, pagePatch) => (
    (pages || []).map((page, index) => (
        index === pageIndex
            ? {
                ...page,
                ...pagePatch,
            }
            : page
    ))
);

export const updatePageGeneratedAsset = (pages, pageIndex, generatedAsset) => (
    mergePageAtIndex(pages, pageIndex, { generatedAsset })
);

export const clearInlineGeneratedResults = (pages) => (
    (pages || []).map((page) => {
        const nextPage = { ...page };
        delete nextPage.generatedResult;
        return nextPage;
    })
);

export const getPageGenerationSettings = (page, fallbackSettings = {}) => {
    const { engine, ...settings } = {
        ...fallbackSettings,
        ...(page?.generationSettings || {}),
    };
    return settings;
};

export const getPersistedOrTransientResult = (page, transientEntry) => {
    if (transientEntry?.success && transientEntry.result) {
        return transientEntry.result;
    }

    return page?.generatedAsset || null;
};

export const getDefaultActiveTab = (project) => (
    project?.mode === 'manga' ? 'planner' : 'creator'
);

export const getPanelReviewLabel = (panel) => {
    switch (panel?.qualityReview) {
        case 'accepted': return 'Quality accepted';
        case 'rejected': return 'Needs regeneration';
        case 'pending': return 'AI output · review';
        default: return '';
    }
};

export const sortLetteringByReadingOrder = (lettering = []) => (
    [...lettering].filter((line) => line?.text).sort((left, right) => (
        (Number(left.readingOrder) || 0) - (Number(right.readingOrder) || 0)
    ))
);

export const getPreviewPages = (project, appMode) => {
    if (appMode === 'manga') {
        return (project?.chapters || []).flatMap((chapter) => chapter?.pages || []);
    }
    return project?.plannedPages || [];
};

export const getPersistedMangaPageForCreator = (project) => {
    const chapter = project?.chapters?.[0];
    const page = chapter?.pages?.[0];
    if (!chapter || !page) return null;
    return {
        ...page,
        chapterId: chapter.id,
        pageId: page.id,
        pageIndex: 0,
        pageContent: page.pageContent || page.storyBeat || '',
    };
};

export const getSafePreviewPageIndex = (pageIndex, pageCount) => {
    const count = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
    if (count === 0) return 0;
    const index = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
    return Math.min(Math.max(index, 0), count - 1);
};

export const getPreviewReadingDirection = (project) => (
    project?.series?.readingDirection === 'ltr' ? 'ltr' : 'rtl'
);
