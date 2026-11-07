# PText in Laravel 13

There are two ways to use PText in Laravel, and you can use both at once.

## A. Frontend (recommended): text never leaves the browser

```bash
npm i @ptext/core
```

```js
// resources/js/ptext.js
import { suggestTools, runTool, listTools } from '@ptext/core';

document.addEventListener('alpine:init', () => {
  Alpine.data('ptext', () => ({
    input: '', output: '', suggestions: [], warnings: [],
    suggest() { this.suggestions = suggestTools(this.input).suggestions; },
    run(tool, options = {}) {
      try { const r = runTool(tool, this.input, options); this.output = r.output; this.warnings = r.warnings; }
      catch (e) { this.warnings = [{ code: e.code, message: e.message }]; }
    },
  }));
});
```

> ⚠️ Do not bind `input`/`output` to Livewire (`wire:model`, `$wire`, entangle). Keep them in Alpine state only.

## B. Backend PHP (queues, artisan, API): call the CLI with Process

```bash
npm i -g @ptext/cli   # or use the vendored build: node /path/to/ptext-core/packages/cli/dist/cli.js
```

```php
<?php
// app/Support/PText.php
namespace App\Support;

use Illuminate\Support\Facades\Process;
use RuntimeException;

final class PText
{
    public function __construct(private string $bin = 'ptext') {}

    /** @return array{ok:bool, tool:string, output:string, data:mixed, stats:array, warnings:array} */
    public function run(string $tool, string $input, array $options = []): array
    {
        $payload = json_encode(['tool' => $tool, 'input' => $input, 'options' => (object) $options], JSON_THROW_ON_ERROR);
        $result = Process::input($payload)->timeout(15)->run([$this->bin, 'exec']);
        $json = json_decode($result->output(), true);
        if (! is_array($json)) {
            throw new RuntimeException('ptext: '.$result->errorOutput());
        }
        return $json; // ok=false → $json['error']['code'] (INVALID_OPTION | INVALID_INPUT | UNKNOWN_TOOL | INPUT_TOO_LARGE)
    }
}

// (new PText)->run('extract-emails', $text)['output'];
```

Exit codes: `0` ok · `2` bad option/tool · `3` bad input · `1` internal error.

## Optional: an AI re-ranks the suggestions (Jev or any other model; text stays in the browser)

`route()` runs the local profiler, then asks a router. Two kinds of model plug in, and both read the same catalog (field meanings + input cards):

- **Jev** (TypeSafe System One) is a decision model: it picks among criteria and returns probabilities, and writes no text. Use `jevRouter()`, see [Jev](#jev-decision-model) below.
- **Generative models** (Claude, GPT, Gemini, a local model) write a JSON reply. Use `llmRouter()`, which gives every model the same input:
- **system**: rules, the meaning of every profile field, and every tool with its input card (`accepts`, `signals`, `avoid`, options, examples). It is static per `version`, so it can be cached, prompt cache included.
- **user**: JSON of `{ profile, candidates: [{ tool, score }] }`. Counts and flags only, never the text.
- **reply**: `{"suggestions":[{tool, score, reason, options?}]}`. The JSON Schema is in `ptext prompt` → `responseSchema`, for models with structured output.

The model may pick any catalog tool. `route()` parses the reply (bare JSON, fenced or inside prose), drops bad entries into `issues`, and falls back to the local list on a timeout, an error or a reply that is not a ranking.

```js
// resources/js/ptext.js — the browser sends only the user message, never `this.input`
import { route, llmRouter } from '@ptext/core';

const ai = llmRouter(async ({ version, user }, signal) => {
  const res = await fetch('/ptext/rank', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content },
    body: JSON.stringify({ version, user }),
  });
  if (!res.ok) throw new Error(`rank ${res.status}`);
  return res.text(); // the model's reply, untouched
});

// inside Alpine.data('ptext', ...)
async suggest() {
  const { suggestions, source } = await route(this.input, { router: ai, timeoutMs: 1500 });
  this.suggestions = suggestions; // source: 'remote' | 'local'
},
```

The backend holds the key and the system prompt, and checks the user message before any model sees it. Swap the model by binding another `RankingModel`.

```php
<?php
// app/Support/RankingModel.php — one method; Jev, OpenAI, Anthropic, Gemini or a local model behind it
namespace App\Support;

interface RankingModel
{
    /** Send system + user, return the reply text. $schema is the reply JSON Schema for structured output. */
    public function complete(string $system, string $user, array $schema): string;
}
```

```php
<?php
// app/Http/Controllers/PTextRankController.php
namespace App\Http\Controllers;

use App\Support\RankingModel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Process;

final class PTextRankController
{
    public function __invoke(Request $request, RankingModel $model)
    {
        $load = fn () => json_decode(Process::run(['ptext', 'prompt'])->throw()->output(), true);
        $prompt = Cache::rememberForever('ptext.prompt', $load);
        if ($request->input('version') !== $prompt['version']) {
            Cache::forget('ptext.prompt'); // core was upgraded: rebuild, and reject a client still on another catalog
            $prompt = Cache::rememberForever('ptext.prompt', $load);
            abort_unless($request->input('version') === $prompt['version'], 409);
        }

        // Allowlist: known profile keys with scalar values, candidates as tool id + score. Free text cannot pass.
        $user = json_decode((string) $request->input('user'), true);
        abort_unless(is_array($user) && is_array($user['profile'] ?? null) && is_array($user['candidates'] ?? null), 422);
        $fields = Cache::rememberForever('ptext.fields.'.$prompt['version'], fn () => json_decode(Process::run(['ptext', 'catalog'])->throw()->output(), true)['fields']);
        $ids = $prompt['responseSchema']['properties']['suggestions']['items']['properties']['tool']['enum'];
        abort_unless(array_keys($user['profile']) === array_keys(array_intersect_key($user['profile'], $fields)), 422);
        foreach ($user['profile'] as $k => $v) {
            abort_unless(is_int($v) || is_float($v) || is_bool($v) || $v === null || ($k === 'delimiter' && in_array($v, ['tab', 'comma', 'pipe', 'semicolon', 'colon'], true)), 422);
        }
        foreach ($user['candidates'] as $c) {
            abort_unless(is_array($c) && array_keys($c) === ['tool', 'score'] && in_array($c['tool'], $ids, true) && is_numeric($c['score']), 422);
        }

        $reply = $model->complete($prompt['system'], json_encode($user, JSON_THROW_ON_ERROR), $prompt['responseSchema']);

        return response($reply, 200, ['content-type' => 'text/plain; charset=utf-8']);
    }
}
```

Bind the model in a service provider (`$this->app->bind(RankingModel::class, ClaudeRankingModel::class)`, for example). Every generative model works the same way: put `system` in the system or instructions field, `user` in the user message, and pass the schema where the API takes one.

### Jev (decision model)

Core turns the catalog into one `choice` question. Each tool is a criterion built from its input card, plus `none`. Jev's probabilities become the ranking, and options come from the local rule for the same tool. The browser builds the `state` (profile, local candidates as tool + score, field meanings). The backend adds the static questions and the key, then returns Jev's JSON untouched, so `jevSuggestions()` in core reads it.

```js
import { route, jevRouter, routerCatalog } from '@ptext/core';

const jev = jevRouter(async ({ state }, signal) => {
  const res = await fetch('/ptext/jev', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content },
    body: JSON.stringify({ version: routerCatalog().version, state }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  return res.json(); // { answers: { tool: { choice, confidence, probabilities } } }
});
const { suggestions, source } = await route(text, { router: jev, timeoutMs: 1500 });
```

```php
// app/Http/Controllers/PTextJevController.php (same allowlist on state.profile and state.local_rules as above)
$jev = Cache::rememberForever('ptext.jev', fn () => json_decode(Process::run(['ptext', 'jev'])->throw()->output(), true));
abort_unless($request->input('version') === $jev['version'], 409);
$state = $request->input('state'); // profile + local_rules checked against the allowlist; fields must equal the catalog's
$res = Http::withToken(config('services.jev.key'))->timeout(5)
    ->post('https://api.typesafe.ai/v1/systemone', ['model' => $jev['model'], 'state' => $state, 'questions' => $jev['questions']]);
return response($res->body(), $res->status(), ['content-type' => 'application/json']);
```

A Node/Worker backend skips the CLI: `rankPrompt(routerCatalog())` and `rankResponseSchema()` come from `@ptext/core`, and the Worker serves them at `GET /api/prompt` and `GET /api/catalog`.

## C. Edge alternative

Deploy `examples/cloudflare-worker` and call `POST /api/run` with `Http::post(...)`. Do this only for data you accept sending to a server.
