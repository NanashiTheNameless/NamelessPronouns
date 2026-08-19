# Known passwords

Source wordlists for the common-password check. Every file comes from
[SecLists](https://github.com/danielmiessler/SecLists) (MIT); thank you to its
maintainers and contributors. Content is unedited, but a source larger than
50 MiB is split into `name.part-01.txt`, `name.part-02.txt`, and so on, because
that is the largest file this repository carries.

Nothing here is served to browsers. `yarn build-password-index` reads these
files and writes `public/password-wordlists/` (`manifest.json` plus one bloom
filter per file in `index.bin`); only that index ships.

## What gets indexed

A line is indexed only if the password policy would accept it: valid UTF-8, 12
to 256 characters, and holding an uppercase letter, a lowercase letter, a
number, and a symbol. Anything else cannot be typed into the signup or
password-change forms, so screening for it would be dead weight. Most lines in
most lists are skipped for that reason.

## Adding a list

Drop a `.txt` file here, one password per line, split at 50 MiB, then rerun
`yarn build-password-index` and commit the regenerated index. Check the build
output first: a list that contributes no entries belongs nowhere near this
directory, and SecLists `-withcount` files never qualify because their lines
carry a leading occurrence count rather than a password.
