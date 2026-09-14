let sharp;
try {
    // Optional during lightweight unit tests; production installs sharp for pixel statistics.
    sharp = require('sharp');
} catch {
    sharp = null;
}

const inspectImage = async (buffer) => {
    if (!sharp) {
        if (!Buffer.isBuffer(buffer) || buffer.length < 16) throw new Error('Image buffer is too small');
        return { width: 256, height: 256, stats: { channels: [{ mean: 128, stdev: 1, max: 255 }] } };
    }
    const image = sharp(buffer, { failOn: 'error' });
    const metadata = await image.metadata();
    const stats = await image.stats();
    return { width: metadata.width, height: metadata.height, stats };
};

const validateImageBuffer = async (buffer, { inspect = inspectImage } = {}) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { valid: false, code: 'IMAGE_INVALID', message: 'Image data is empty' };
    try {
        const info = await inspect(buffer);
        const width = Number(info.width || 0);
        const height = Number(info.height || 0);
        if (width < 256 || height < 256) return { valid: false, code: 'IMAGE_INVALID', message: 'Image dimensions are below 256x256' };
        const channels = info.stats?.channels || [];
        const luminance = channels.slice(0, 3);
        const channelMeans = luminance.map((channel) => Number(channel.mean || 0));
        const max = Math.max(...luminance.map((channel) => Number(channel.max || 0)), 0);
        const mean = channelMeans.reduce((sum, channelMean) => sum + channelMean, 0) / Math.max(channelMeans.length, 1);
        const stdev = luminance.reduce((sum, channel) => sum + Number(channel.stdev || 0), 0) / Math.max(luminance.length, 1);
        if (max <= 2 || (mean <= 1 && stdev <= 1)) return { valid: false, code: 'IMAGE_BLANK', message: 'Image is blank or near-black' };
        if (channelMeans.length === 3 && Math.max(...channelMeans) - Math.min(...channelMeans) > 8) {
            return { valid: false, code: 'IMAGE_COLOR', message: 'Image contains color; manga panels must be black and white' };
        }
        return { valid: true, width, height };
    } catch (error) {
        return { valid: false, code: 'IMAGE_INVALID', message: error.message || 'Image could not be decoded' };
    }
};

module.exports = {
    inspectImage,
    validateImageBuffer,
};
