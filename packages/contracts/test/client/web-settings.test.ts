import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { WebSettings, defaultWebSettings } from "../../src/client/settings.ts";

const decode = Schema.decodeUnknownSync(WebSettings);

it.each(["http://sheprd.example.test", "http://sheprd.example.test:8080", "http://127.0.0.1:8787"])(
  "FR-001 settings schema refuses an HTTP publicAddress %s with an HTTPS explanation", (publicAddress) => {
    expect(() => decode({ ...defaultWebSettings, publicAddress })).toThrow(/https/i);
  }
);

it.each(["https://sheprd.example.test", "https://sheprd.example.test:9443"])(
  "FR-001 settings schema keeps canonical HTTPS publicAddress %s", (publicAddress) => {
    expect(decode({ ...defaultWebSettings, proxyMode: true, publicAddress })).toMatchObject({ publicAddress });
  }
);
