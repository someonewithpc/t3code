import * as NodeFS from "node:fs";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as IpcChannels from "../channels.ts";
import { makeSyncIpcMethod } from "../DesktopIpc.ts";

const LocalStorageOverrides = Schema.Record(Schema.String, Schema.String);
const decodeOverrides = Schema.decodeUnknownOption(Schema.fromJsonString(LocalStorageOverrides));

// Lets a config manager pin renderer preferences that only live in
// localStorage, such as the theme. Missing or malformed files change nothing.
// Sync IPC handlers run under Effect.runSync, so the read has to be blocking.
export const getLocalStorageOverrides = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_STORAGE_OVERRIDES_CHANNEL,
  result: Schema.NullOr(LocalStorageOverrides),
  handler: Effect.fn("desktop.ipc.localStorageOverrides.get")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const file = environment.path.join(environment.stateDir, "local-storage.json");
    const text = yield* Effect.try(() => NodeFS.readFileSync(file, "utf8")).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (text === null) return null;
    return Option.getOrNull(decodeOverrides(text));
  }),
});
