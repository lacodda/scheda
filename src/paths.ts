// Comparing two paths, which is harder than it should be.
//
// The same file arrives spelled two ways: the tree carries whatever the
// filesystem returned — backslashes on Windows — while a document path can come
// from a command line typed by hand, and a rename answers with whatever the
// core made of it. A `===` between those is false for one file, and the first
// version of the tree compared them that way: the branch holding the open file
// silently never opened.
//
// Kept apart from any component because the editor needs the same answer: a tab
// following a renamed file, and a tab losing its file to a deleted folder, are
// both this question.

function normalise(path: string): string {
  // Case is folded as well: Windows treats `Notes` and `notes` as one folder,
  // and a tree that disagrees with the filesystem is worse than no tree.
  return path
    .split(/[\\/]+/)
    .join('/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Whether two paths name one file. */
export function samePath(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}

/** Whether `file` lies under `folder`.
 *
 *  The separator is part of the test: `C:\vault\Projects\one.md` starts with
 *  `C:\vault\Proj` as a string and is not in that folder at all. */
export function isInside(folder: string, file: string): boolean {
  return normalise(file).startsWith(normalise(folder) + '/')
}

/** The last component of a path. */
export function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/** Everything before the last component, or '' when there is nothing before it. */
export function dirname(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? '' : path.slice(0, cut)
}
