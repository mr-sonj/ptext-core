# @ptext/cli

**Text tools for the terminal.** The `ptext` command for [PText](https://github.com/mr-sonj/ptext-core): pipe text in to remove duplicate lines, convert CSV to JSON, extract emails, URLs, domains or IP addresses, clean up lines, split and select columns, Base64 or URL encode/decode, and format, validate or minify JSON. Text on stdin, result on stdout, warnings on stderr, and a JSON mode for PHP/Laravel, Python and shell scripts.

```bash
npm install -g @ptext/cli

printf 'apple\nbanana\napple\n' | ptext run remove-duplicates     # apple, banana
cat data.csv | ptext run csv-to-json
echo 'a@x.com, b@y.io, a@x.com' | ptext run extract-emails        # a@x.com, b@y.io
echo '{"b":1,"a":[1,2]}' | ptext run json-format                  # pretty-printed
echo '{"tool":"extract-emails","input":"a@x.com"}' | ptext exec   # JSON in, JSON out
ptext --help                                                      # commands, examples, tool ids
ptext list                                                        # every tool and option
```

Results come from deterministic code, never from an AI model, and the command makes no network calls.

Exit codes: `0` ok · `2` usage or option error · `3` invalid input · `1` internal error.

Full documentation and how-to guides: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#cli). License: MIT.
