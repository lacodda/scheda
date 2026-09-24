---
title: Writing
description: Focus mode, the word count, the front matter form, tables from the keyboard, moving sections, spelling, printing and exporting a note.
---

The tools here are for the long stretch of writing a note rather than reading
one. None of them changes a character you did not ask it to change: a mode is a
way of showing the text, and an edit is always an edit you can undo with one
`Ctrl+Z`.

## Focus mode

`Ctrl+Shift+D` fades everything but the section you are writing in. A section
is what a heading owns: from the heading above the caret to the next heading of
any level, so inside a chapter with four subsections only the one you are in
stays in full colour. The text before the first heading is a section of its own.

The other sections fade rather than disappear — where the section sits among
the others is part of writing it. The status bar says `focus` while the mode is
on. It belongs to the window, not the note: switching tabs keeps it on, and
`Ctrl+Shift+D` again turns it off.

## Words and reading time

The status bar counts the words of the note's body — the front matter is not
counted — and the minutes it takes to read, at 200 words a minute, rounded up.
Select some text and the count becomes `56 of 1,240 words`: how long a
paragraph is, is a question you ask by selecting it.

A word is a run of characters between spaces that has a letter or a digit in
it. The `#` before a heading, the `-` of a list item and a dash between clauses
are not words; `**bold**` is one.

## The front matter form

A note's front matter folds into one line saying how many fields it has. Click
the line and it opens as a form, one row per field, with a control that fits the
value:

| Value | Control |
| --- | --- |
| `true` / `false` | A checkbox |
| `2026-09-24` | A date picker |
| `4`, `4.5` | A box for a number |
| `[a, b]` or a block of `- a` lines | Pills, each with `×`, and a box to add one |
| Anything else on one line | A text box |

A change is written the moment you make it — `Enter` or leaving the box for
text, a click for a checkbox or a pill. What is written is the field you changed
and nothing else: the order of the keys, comments, blank lines and every other
field stay exactly as they were. Text that would read back as something else is
quoted for you, so a title of `Part 2: the rain` is written as
`"Part 2: the rain"` and a tag of `true` stays text rather than becoming a
checkbox. A value that was already quoted keeps its quotes.

**Add a field** at the bottom takes a key; the new field starts empty, and what
you type into it decides its type, the way YAML itself reads it.

A field the form cannot hold — a nested map, a `|` block — is shown but not
edited. **Edit as YAML** shows the fields as text; the small **form** link at
the end of the first `---` goes back. Putting the caret inside the fields shows
them as text too. In reading mode the form is read-only.

## Tables from the keyboard

Inside a table:

| Keys | What it does |
| --- | --- |
| `Tab` | The next cell — its text selected, so typing replaces it. Past the last cell, a new row |
| `Shift+Tab` | The cell before |
| `Enter` | A new row under this one, the caret in the same column. On an empty last row, leaves the table |
| `Ctrl+Alt+→` / `Ctrl+Alt+←` | A new column after or before the caret's |
| `Ctrl+Alt+Backspace` | Removes the caret's column from every row |

The row of dashes is skipped, and a pipe inside code or escaped as `\|` is not a
column boundary. The edits add the fewest characters that do the job; the
columns line up on screen by themselves, without the source being padded. Outside
a table these keys do what they always did — `Tab` in a list still indents the
item.

## Moving a section

Drag a heading in the outline (`Ctrl+Shift+O`) onto another one, and its section
moves to just before it — the heading with everything under it, subsections
included. Drop it on the strip below the last heading to move it to the end.
The heading keeps its level: a `###` moved under a different parent is still a
`###`. One `Ctrl+Z` puts the note back.

## Spelling

The system's spell checker underlines misspelt words once
`"spellcheck": true` is in the [settings](/scheda/reference/settings/#spellcheck).
It is off by default: code, paths and names are all misspellings to a checker.

Two limits come from the engine the window is drawn with (WebView2), not from
scheda:

- The checker uses one dictionary — the language of Windows itself. scheda marks
  each note with the language it is written in, but WebView2 does not read that
  mark yet, so on a Russian Windows the English words are not checked.
- After the window opens, the underlines appear once you click into the text.

## Printing and exporting

| Keys | What it does |
| --- | --- |
| `Ctrl+Alt+P` | Prints the note |
| `Ctrl+Alt+S` | Saves the note as one HTML file, asking where |

Both make the same page: the note as reading mode shows it — no markers, no
front matter, a ```` ```mermaid ```` block drawn as its diagram — in a light,
plain style meant for paper. Printing prints that page, not the window, through
the system's print dialog, where **Microsoft Print to PDF** makes a PDF.

The exported file stands on its own. Pictures from the vault travel inside it,
so it can be mailed or moved without the folder beside it; a picture whose link
leads outside the note's folder is left out and shows its text. HTML written
into the note is shown as text rather than run, and only web and mail links stay
links — a link to another note has nowhere to go in a page on its own.
