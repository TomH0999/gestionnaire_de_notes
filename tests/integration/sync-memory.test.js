import { defineSyncScenarios } from "./sync-scenarios.js";
import { MemoryServer } from "../../js/data/backends/memory-server.js";
import { createClock } from "./helpers.js";

defineSyncScenarios("serveur en mémoire", async () => {
    const clock = createClock();
    const server = new MemoryServer({ now: clock.now });
    return {
        server,
        clock,
        realtime: true,
        createUser: async (email, password) => server.signUp(email, password),
        rowsOf: async (email) => server.rowsOf(server.users.get(email).id),
        expireSession: async (device) => server.expireToken(device.backend.token)
    };
});
