const ABOUT_BANNER_VIDEO_FILE_ID = 'cloud://homefind-5gvurhe3ed767f0f.686f-homefind-5gvurhe3ed767f0f-1413768904/about/about-banner.mp4';
const ABOUT_BANNER_POSTER_FILE_ID = 'cloud://homefind-5gvurhe3ed767f0f.686f-homefind-5gvurhe3ed767f0f-1413768904/about/about-banner-poster.jpg';

async function getAboutBannerMedia() {
  const result = await wx.cloud.getTempFileURL({
    fileList: [ABOUT_BANNER_VIDEO_FILE_ID, ABOUT_BANNER_POSTER_FILE_ID]
  });

  const urlMap = {};
  (result.fileList || []).forEach((item) => {
    if (item && item.fileID && item.tempFileURL) {
      urlMap[item.fileID] = item.tempFileURL;
    }
  });

  return {
    videoUrl: urlMap[ABOUT_BANNER_VIDEO_FILE_ID] || '',
    posterUrl: urlMap[ABOUT_BANNER_POSTER_FILE_ID] || ''
  };
}

module.exports = {
  getAboutBannerMedia
};
