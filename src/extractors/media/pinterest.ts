import { mediaError } from "../../errors";
import { record, records, text, number, httpUrl, type Info, type ResolvedMedia } from "./metadata";
import { fetchMediaPage } from "./http";
import { loadYtDlpInfo, resolveYtDlpInfo } from "./yt-dlp";

export function parsePinterestGallery(data: Info): Info[] | null {
  const story = record(data.story_pin_data) ? data.story_pin_data : {};
  if (!Array.isArray(story.pages)) return null;
  const entries: Info[] = [];
  for (const [pageIndex, page] of story.pages.entries()) {
    if (!record(page)) {
      entries.push({});
      continue;
    }
    // Page videos contain the composed scene. Otherwise preserve each original media block.
    const blocks = record(page.video) ? [page] : records(page.blocks);
    if (!blocks.length) {
      entries.push({});
      continue;
    }
    for (const [blockIndex, block] of blocks.entries()) {
      const id = `${text(data.id)}-${pageIndex + 1}-${blockIndex + 1}`;
      const video = record(block.video) ? block.video : {};
      const variants = record(video.video_list) ? Object.values(video.video_list).filter(record) : [];
      if (variants.length) {
        const formats = variants
          .filter((v) => httpUrl(v.url) && text(v.url).split("?")[0]?.endsWith(".mp4"))
          .sort((a, b) => (number(a.width) ?? 0) - (number(b.width) ?? 0))
          .map((v, i) => ({ ...v, format_id: String(i), ext: "mp4", protocol: "https" }));
        entries.push({
          id,
          title: id,
          formats,
          extractor: "Pinterest",
          webpage_url: `https://www.pinterest.com/pin/${text(data.id)}/`,
        });
      } else {
        const image = record(block.image) ? block.image : {};
        const images = record(image.images) ? image.images : {};
        const original = record(images.originals) ? images.originals : {};
        entries.push({
          id,
          outform_image: true,
          thumbnail: original.url,
          thumbnails: Object.values(images).filter(record),
        });
      }
    }
  }
  if ((number(story.page_count) ?? 0) > story.pages.length) entries.push({});
  return entries;
}

export async function resolvePinterest(url: string): Promise<ResolvedMedia> {
  const info = await loadYtDlpInfo(url, "pinterest");
  if (/^\d+$/.test(text(info.id))) {
    const endpoint = new URL("https://www.pinterest.com/resource/PinResource/get/");
    endpoint.searchParams.set(
      "data",
      JSON.stringify({ options: { id: info.id, field_set_key: "unauth_react_main_pin" } }),
    );
    const body = await fetchMediaPage(
      endpoint,
      { "User-Agent": "Mozilla/5.0", "X-Pinterest-PWS-Handler": "www/[username].js" },
      url,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw mediaError(
        "Pinterest returned unreadable gallery metadata. Retry later; if it persists, report the public post URL with outform feedback.",
        url,
      );
    }
    const data = record(payload) && record(payload.resource_response) ? payload.resource_response.data : null;
    if (!record(data)) throw mediaError("Pinterest did not expose the post's media list anonymously.", url);
    const gallery = parsePinterestGallery(data);
    if (gallery) info.entries = gallery;
  }
  return resolveYtDlpInfo(info, url, "pinterest");
}
