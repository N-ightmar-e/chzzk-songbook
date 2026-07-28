export function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}

// 영상 제목에서 곡명·가수 후보를 뽑는다. 어느 쪽이 곡명인지는 영상마다 달라
// 판단하지 않고 후보만 돌려주고, 사용자가 고르게 한다.
const NOISE = /\[[^\]]*\]|\([^)]*\)|【[^】]*】|「[^」]*」|MR|Karaoke|カラオケ|instrumental|inst\.?|off\s*vocal|노래방|반주|음원|가사|lyrics|고음질|4K|HD/gi;

export function suggestFromTitle(videoTitle) {
  if (!videoTitle) return [];
  const cleaned = videoTitle.replace(NOISE, " ").replace(/\s+/g, " ").trim();
  return cleaned
    .split(/\s*[-–—|/／·:：]\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length < 60);
}
