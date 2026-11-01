import { parseHTML } from "linkedom";
import { OutformError, mediaError } from "../../errors";
import { fetchMediaPage } from "./http";
import {
  record,
  records,
  text,
  number,
  httpUrl,
  type ResolvedMedia,
  type MediaResult,
  type MediaTransfer,
} from "./metadata";

function spotifyPost(url: string): { kind: "episode" | "track"; id: string; canonical: string } {
  const match = new URL(url).pathname.match(/\/(episode|track)\/([A-Za-z0-9]{22})\/?$/);
  if (!match) throw mediaError("Use an individual Spotify episode or track URL.", url);
  const kind = match[1] as "episode" | "track";
  return { kind, id: match[2]!, canonical: `https://open.spotify.com/${kind}/${match[2]}` };
}

export function parseSpotifyPage(html: string, source: string): ResolvedMedia {
  const post = spotifyPost(source);
  let data: unknown;
  try {
    const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    data = script ? JSON.parse(script) : null;
  } catch {
    throw mediaError(
      "Spotify returned unreadable metadata. Retry later; if it persists, report the public URL with outform feedback.",
      source,
    );
  }
  const props = record(data) && record(data.props) ? data.props : {};
  const pageProps = record(props.pageProps) ? props.pageProps : {};
  const state = record(pageProps.state) ? pageProps.state : {};
  const payload = record(state.data) ? state.data : {};
  const entity = record(payload.entity) ? payload.entity : {};
  if (entity.id !== post.id || entity.type !== post.kind || !text(entity.name || entity.title))
    throw mediaError(
      "Spotify did not expose metadata for the requested item. It may be unavailable anonymously. Check the original URL or retry later.",
      source,
    );

  const identity = record(entity.visualIdentity) ? entity.visualIdentity : {};
  const covers = records(identity.image).sort((a, b) => (number(b.maxWidth) ?? 0) - (number(a.maxWidth) ?? 0));
  const thumbnail = covers.map((cover) => httpUrl(cover.url)).find(Boolean) ?? null;
  const release = record(entity.releaseDate) ? text(entity.releaseDate.isoString) : "";
  const parsedDate = Date.parse(release);
  const result: MediaResult = {
    platform: "spotify",
    id: post.id,
    title: text(entity.title) || text(entity.name),
    description: text(entity.description),
    author:
      text(entity.subtitle) ||
      records(entity.artists)
        .map((artist) => text(artist.name))
        .filter(Boolean)
        .join(", ") ||
      null,
    thumbnail,
    source,
    uploadDate: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString().slice(0, 10) : null,
    media: [],
    directory: null,
    issues: [],
  };
  const transfers = new Map<number, MediaTransfer>();
  const audio = record(payload.defaultAudioFileObject) ? payload.defaultAudioFileObject : {};
  const preview = record(entity.audioPreview) ? httpUrl(entity.audioPreview.url) : null;
  const direct = httpUrl(audio.passthroughUrl);
  if (entity.isPlayable === false) {
    result.issues.push(
      mediaError(
        "Spotify reports that this item is unavailable from this connection. Try another public episode or the publisher's public RSS feed.",
        source,
        "MEDIA_RESTRICTED",
      ).issue,
    );
  } else if (post.kind === "track") {
    result.issues.push(
      mediaError(
        "Spotify music downloads are not supported. Available metadata is included; a preview is not a full track.",
        source,
      ).issue,
    );
  } else if (
    audio.passthrough === "ALLOWED" &&
    direct &&
    direct !== preview &&
    !new URL(direct).pathname.includes("/mp3-preview/")
  ) {
    const milliseconds = number(entity.duration);
    result.media.push({
      id: post.id,
      index: 1,
      kind: "audio",
      url: direct,
      thumbnail,
      width: null,
      height: null,
      duration: milliseconds === null ? null : milliseconds / 1000,
      file: null,
    });
    transfers.set(1, { type: "http", candidates: [{ url: direct }] });
  } else {
    result.issues.push(
      mediaError(
        "Spotify did not expose a public original-audio URL for this episode. It may be restricted or protected. Outform does not substitute a preview. Try the publisher's public RSS feed.",
        source,
      ).issue,
    );
  }
  return { result, transfers };
}

export async function resolveSpotify(url: string): Promise<ResolvedMedia> {
  const post = spotifyPost(url);
  const headers = { "User-Agent": "Mozilla/5.0" };
  const html = await fetchMediaPage(`https://open.spotify.com/embed/${post.kind}/${post.id}`, headers, url);
  const resolved = parseSpotifyPage(html, url);
  if (!resolved.result.description) {
    try {
      const page = await fetchMediaPage(post.canonical, headers, url);
      resolved.result.description =
        parseHTML(page).document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    } catch (error) {
      // Optional description failure must not discard a verified public audio source.
      if (!(error instanceof OutformError) || error.code === "RATE_LIMITED") throw error;
      resolved.result.issues.push({ ...error.issue, message: `Spotify description unavailable: ${error.message}` });
    }
  }
  return resolved;
}
