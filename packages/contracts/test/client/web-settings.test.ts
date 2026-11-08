import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { WebSettings, defaultWebSettings } from "../../src/client/settings.ts";

const decode = Schema.decodeUnknownSync(WebSettings);

it.each(["http://lgcode.example.test", "http://lgcode.example.test:8080", "http://127.0.0.1:8787"])(
  "FR-001 settings schema refuses an HTTP publicAddress %s with an HTTPS explanation", (publicAddress) => {
    expect(() => decode({ ...defaultWebSettings, publicAddress })).toThrow(/https/i);
  }
);

it.each(["https://lgcode.example.test", "https://lgcode.example.test:9443"])(
  "FR-001 settings schema keeps canonical HTTPS publicAddress %s", (publicAddress) => {
    expect(decode({ ...defaultWebSettings, proxyMode: true, publicAddress })).toMatchObject({ publicAddress });
  }
);
