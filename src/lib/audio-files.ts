// Telling audio and video files apart from what else a folder holds (artwork,
// playlists, notes), by name, for uploads from this computer and from cloud
// storage. Some systems give no type for formats like FLAC or Opus, hence the
// extensions; names starting with a dot are hidden files, e.g. macOS's "._" ones.
const audioExtension = /\.(mp3|m4a|m4b|aac|wav|flac|ogg|oga|opus|wma|aiff?|mp4|m4v|mkv|webm|mov|avi)$/i

export function isAudioFileName(name: string, type = '') {
  return !name.startsWith('.') && (/^(audio|video)\//.test(type) || audioExtension.test(name))
}

// Files in name order, as a folder's episodes are added.
export const byFileName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
