import { mediaError } from "../../errors";
import { record, records, text, httpUrl, type Info, type ResolvedMedia } from "./metadata";
import { fetchMediaPage } from "./http";
import { loadYtDlpInfo, resolveYtDlpInfo } from "./yt-dlp";

export function parseTikTokSlides(html: string): Info[] {
  const script = html.match(
    /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!script) return [];
  const data = JSON.parse(script);
  const item = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!record(item) || item.privateItem === true || item.takeDown === true) return [];
  const post = record(item.imagePost) ? item.imagePost : {};
  return records(post.images).map((image, index) => {
    const urls = record(image.imageURL) && Array.isArray(image.imageURL.urlList) ? image.imageURL.urlList : [];
    return {
      id: `${text(item.id)}-${index + 1}`,
      outform_image: true,
      thumbnails: urls.filter(httpUrl).map((url) => ({ url, width: image.imageWidth, height: image.imageHeight })),
    };
  });
}

export async function resolveTikTok(url: string, signal?: AbortSignal): Promise<ResolvedMedia> {
  const request = url.replace(/\/photo\/(\d+)/, "/video/$1");
  const info = await loadYtDlpInfo(url, "tiktok", request, signal);
  if (/\/photo\//.test(url) || records(info.formats).every((f) => f.vcodec === "none")) {
    const html = await fetchMediaPage(
      httpUrl(info.webpage_url) ?? request,
      { "User-Agent": "Mozilla/5.0" },
      url,
      signal,
    );
    let slides: Info[];
    try {
      slides = parseTikTokSlides(html);
    } catch {
      throw mediaError(
        "TikTok returned unreadable photo metadata. Retry later; if it persists, report the public post URL with outform feedback.",
        url,
      );
    }
    if (!slides.length)
      throw mediaError("TikTok did not expose this photo post anonymously. No slideshow images were downloaded.", url);
    // A photo post's sole yt-dlp format is its soundtrack, not a video of the slides.
    info.entries = [...slides, ...(records(info.formats).length ? [{ ...info, entries: undefined }] : [])];
  }
  return resolveYtDlpInfo(info, url, "tiktok");
}
