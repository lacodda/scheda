---
title: The status bar
description: What each field along the bottom of the window is telling you.
---

The bar along the bottom of the window reports what scheda knows about the file
it is holding — and, in particular, the facts that decide what happens when you
save.

| Field | Meaning |
| --- | --- |
| Name | The file name, or `Untitled` for a buffer that has never been saved. A `•` after it means there are unsaved changes. |
| `read-only` | The file could not be decoded as UTF-8. It is shown but will not be written back. |
| `Ln`, `Col` | The cursor position. Columns count characters from 1. |
| chars | The document length in characters, not bytes. |
| `LF` / `CRLF` / `mixed` | The line endings the file was read with, and the ones it will be saved with. `mixed` means the file uses both, and each line keeps its own. |
| `UTF-8` / `UTF-8 BOM` | Whether the file starts with a byte-order mark. It will be saved the same way. |

The last two fields are the ones worth glancing at before saving a file that
came from somewhere else: they are scheda telling you exactly what it is about
to write. See [Byte for byte](/scheda/concepts/byte-for-byte/).
