const path = require('path');
const { readJson, writeJson } = require('./storage');
const { assertValidProjectId } = require('./validation');

const MAX_HISTORY_ITEMS = 200;

const createGenerationHistoryStore = ({ rootDir }) => {
    const locks = new Map();
    const getHistoryPath = (projectId) => path.join(rootDir, 'projects', assertValidProjectId(projectId), 'generation-history.json');

    const withLock = (projectId, operation) => {
        const previous = locks.get(projectId) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        locks.set(projectId, current);
        return current.finally(() => {
            if (locks.get(projectId) === current) locks.delete(projectId);
        });
    };

    const listHistory = async (projectId) => readJson(getHistoryPath(projectId), []);

    const appendHistory = async (projectId, entry) => {
        if (!projectId) {
            return null;
        }

        const safeProjectId = assertValidProjectId(projectId);
        return withLock(safeProjectId, async () => {
            const currentHistory = await listHistory(safeProjectId);
            const nextEntry = {
                ...entry,
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                projectId: safeProjectId,
                timestamp: new Date().toISOString(),
            };
            const nextHistory = [nextEntry, ...currentHistory].slice(0, MAX_HISTORY_ITEMS);
            await writeJson(getHistoryPath(safeProjectId), nextHistory);
            return nextEntry;
        });
    };

    return {
        appendHistory,
        listHistory,
    };
};

module.exports = {
    createGenerationHistoryStore,
};
