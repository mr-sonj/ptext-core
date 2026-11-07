# @ptext/cli

The `ptext` command for [PText](https://github.com/mr-sonj/ptext-core): text on stdin, result on stdout, with a JSON mode for PHP/Laravel, Python and shell scripts.

```bash
npm install -g @ptext/cli

echo 'a@x.com, b@y.io, a@x.com' | ptext run extract-emails
echo '{"tool":"extract-emails","input":"a@x.com"}' | ptext exec
ptext list
```

Exit codes: `0` ok · `2` usage or option error · `3` invalid input · `1` internal error.

Full documentation: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#cli). License: MIT.
