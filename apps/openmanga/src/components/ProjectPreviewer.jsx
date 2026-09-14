import React, { useEffect, useMemo, useState } from 'react';
import { getDisplayImageSrc } from '../lib/assets.mjs';
import { extractVerbatimSegments } from '../lib/storySegments.mjs';
import { getPreviewPages, getPreviewReadingDirection, getSafePreviewPageIndex, sortLetteringByReadingOrder } from '../lib/projectPages.mjs';

const ProjectPreviewer = ({ isOpen, onClose, project, appMode }) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [textMode, setTextMode] = useState('full');
    const pages = getPreviewPages(project, appMode);

    useEffect(() => {
        setCurrentPage((pageIndex) => getSafePreviewPageIndex(pageIndex, pages.length));
    }, [project?.id, appMode, pages.length]);

    const verbatimSegments = useMemo(
        () => extractVerbatimSegments(project?.story, pages),
        [project?.story, pages]
    );

    if (!isOpen || !project) return null;

    const currentData = pages[currentPage];
    const hasNext = currentPage < pages.length - 1;
    const hasPrev = currentPage > 0;
    const imageSrc = getDisplayImageSrc(currentData?.generatedAsset);
    const mangaPanels = currentData?.panels || [];
    const rejectedPanelCount = mangaPanels.filter((panel) => panel.qualityReview === 'rejected').length;
    const pendingPanelCount = mangaPanels.filter((panel) => panel.qualityReview === 'pending').length;

    return (
        <div className="modal-overlay previewer-overlay" onClick={onClose}>
            <div className="previewer-card animate-in" onClick={(event) => event.stopPropagation()}>
                <div className="previewer-header">
                    <div className="project-info">
                        <h3 className="heading-font">{project.name}</h3>
                        <span className="page-indicator">Page {currentPage + 1} of {pages.length}{appMode === 'manga' ? ' · Reads right-to-left (panel 1 top-right)' : ''}</span>
                        {appMode === 'manga' && (
                            <>
                                <span className="page-indicator" style={{ opacity: 0.75 }}>Badges: Quality accepted = keep · Needs regeneration = reject · AI output · review = vote needed</span>
                                {(rejectedPanelCount > 0 || pendingPanelCount > 0) && (
                                    <span className={`manga-review-summary ${rejectedPanelCount > 0 ? 'has-rejected' : ''}`} aria-live="polite">
                                        {rejectedPanelCount > 0 ? `${rejectedPanelCount} panel${rejectedPanelCount === 1 ? '' : 's'} need regeneration` : `${pendingPanelCount} panel${pendingPanelCount === 1 ? '' : 's'} awaiting review`}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {appMode === 'storybook' && (
                        <div className="text-toggle-group">
                            <button className={`toggle-pill ${textMode === 'short' ? 'active' : ''}`} onClick={() => setTextMode('short')}>
                                Short
                            </button>
                            <button className={`toggle-pill ${textMode === 'full' ? 'active' : ''}`} onClick={() => setTextMode('full')}>
                                Full Story
                            </button>
                            <button className={`toggle-pill ${textMode === 'prompt' ? 'active' : ''}`} onClick={() => setTextMode('prompt')}>
                                Prompt
                            </button>
                        </div>
                    )}
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className={`previewer-body ${appMode}`}>
                    {appMode === 'storybook' ? (
                        <div className="storybook-layout">
                            <div className="storybook-text-side">
                                <div className="text-content">
                                    {textMode === 'prompt'
                                        ? currentData?.pageContent || 'No prompt description found.'
                                        : textMode === 'short'
                                            ? currentData?.storySegment || 'No summary found.'
                                            : verbatimSegments[currentPage] || currentData?.storySegment || 'No story segment found.'}
                                </div>
                            </div>
                            <div className="storybook-image-side">
                                {imageSrc ? (
                                    <img src={imageSrc} alt={`Page ${currentPage + 1}`} className="preview-img" />
                                ) : (
                                    <div className="preview-placeholder">
                                        <div className="loader small"></div>
                                        <p>Image not generated for this page</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="manga-layout">
                            {mangaPanels.length > 0 ? (
                                <div className={`manga-preview-panels panels-${Math.min(mangaPanels.length, 6)}`} dir={getPreviewReadingDirection(project)}>
                                    {mangaPanels.map((panel) => {
                                        const panelImage = getDisplayImageSrc(panel.generatedAsset);
                                        return (
                                            <div className="manga-preview-panel" key={panel.id || panel.order}>
                                                <span className="manga-preview-number">{panel.order}</span>
                                                {panelImage ? <img src={panelImage} alt={`Page ${currentPage + 1}, panel ${panel.order}`} className="preview-img manga-panel" /> : <div className="preview-placeholder"><p>Panel {panel.order} not generated</p></div>}
                                                {panel.qualityReview === 'rejected' && <span className="manga-preview-review rejected">Needs regeneration</span>}
                                                {panel.qualityReview === 'pending' && <span className="manga-preview-review">AI output · review</span>}
                                                {panel.qualityReview === 'accepted' && <span className="manga-preview-review accepted">Quality accepted</span>}
                                                {sortLetteringByReadingOrder(panel.dialogue || []).map((line) => <div className="manga-preview-lettering" dir="ltr" key={line.id || line.text} title={line.text}>{line.text}</div>)}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : imageSrc ? (
                                <img src={imageSrc} alt={`Page ${currentPage + 1}`} className="preview-img manga-page" />
                            ) : (
                                <div className="preview-placeholder">
                                    <div className="loader small"></div>
                                    <p>Manga page not generated or assembled</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="previewer-footer">
                    <button className="nav-arrow prev" onClick={() => hasPrev && setCurrentPage(currentPage - 1)} disabled={!hasPrev}>
                        {'< Previous'}
                    </button>
                    <div className="progress-dots">
                        {pages.map((_, index) => (
                            <div key={index} className={`dot ${index === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(index)} />
                        ))}
                    </div>
                    <button className="nav-arrow next" onClick={() => hasNext && setCurrentPage(currentPage + 1)} disabled={!hasNext}>
                        {'Next >'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProjectPreviewer;
