---
title: Opening .md with scheda
description: How scheda registers itself as a markdown handler on Windows, and why the final choice is yours.
---

Installing scheda on Windows registers it as a handler for `.md`, `.markdown`,
`.mdown` and `.mkd`. After that scheda appears in Explorer's **Open with** menu
and in **Settings → Apps → Default apps**.

It does *not* become your default markdown editor on its own.

## Why not

Windows does not let a program make itself the default handler for a file type.
That setting belongs to you, and the API to force it has been closed since
Windows 8: the choice is recorded with a hash the shell verifies, and anything
that writes it from outside is either rejected or reset on the next update.

So the install offers the type rather than taking it. Whatever editor you had
pointed at `.md` keeps it until you say otherwise.

## Making it the default

Either way works, and both stick:

- **From a file.** Right-click any `.md` → *Open with* → *Choose another app* →
  **scheda** → *Always use this app*.
- **From Settings.** *Settings → Apps → Default apps → scheda*, then set the
  file types you want.

## What gets written

Everything lives under `HKEY_CURRENT_USER`, so installing needs no
administrator and changes nothing for other accounts on the machine:

| Key | What it is for |
| --- | --- |
| `Software\Classes\lacodda.scheda.markdown` | The type itself: its name, its icon, and the command that opens it |
| `Software\Classes\Applications\scheda.exe` | What the **Open with** list reads |
| `Software\Classes\.md\OpenWithProgids` | The offer — one entry added beside whatever is already there |
| `Software\lacodda\scheda\Capabilities` | What **Default apps** shows |
| `Software\RegisteredApplications` | The announcement that makes the two above visible |

`.txt` is deliberately left alone. scheda opens plain text perfectly well, but
claiming the type would take it from something you almost certainly chose on
purpose.

## Removing it

Uninstalling takes every one of those keys back out, including the single entry
in each extension's handler list — the neighbours in that list belong to other
editors and are left untouched.

You can also do it without the installer:

```sh
scheda --unregister    # take the registration back out
scheda --register      # put it back
```

Both are meant for the installer and print nothing on success.
