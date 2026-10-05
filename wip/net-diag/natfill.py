# Headroom test for the router's NAT table: hold N extra TCP connections (to 1.1.1.1:443, handshake only) and
# probe new connections to www.google.com:443 meanwhile. Prints how many of the N and of the probes failed.
import asyncio, sys, time
N = int(sys.argv[1]); HOLD = float(sys.argv[2]) if len(sys.argv) > 2 else 20; BATCH = int(sys.argv[3]) if len(sys.argv) > 3 else 50; GAP = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2

async def opener(i, held, fails):
    try:
        r, w = await asyncio.wait_for(asyncio.open_connection('1.1.1.1', 443), 5)
        held.append(w)
    except Exception as e:
        fails.append(type(e).__name__ + ":" + str(getattr(e, "errno", "")))

async def probes(stop, res):
    while not stop.is_set():
        t = time.time()
        try:
            r, w = await asyncio.wait_for(asyncio.open_connection('www.google.com', 443), 5)
            w.close(); res.append(('ok', round(time.time() - t, 3)))
        except Exception as e:
            res.append((type(e).__name__, round(time.time() - t, 3)))
        await asyncio.sleep(0.3)

async def main():
    held, fails, res = [], [], []
    stop = asyncio.Event()
    p = asyncio.create_task(probes(stop, res))
    for k in range(0, N, BATCH):
        await asyncio.gather(*(opener(i, held, fails) for i in range(k, min(N, k + BATCH))))
        await asyncio.sleep(GAP)
    await asyncio.sleep(HOLD)
    stop.set(); await p
    for w in held: w.close()
    bad = [r for r in res if r[0] != 'ok']
    kinds = {}
    for f in fails + [b[0] for b in bad]: kinds[f] = kinds.get(f, 0) + 1
    print(f'N={N}: held {len(held)}, open failures {len(fails)}; probes {len(res)}, failed {len(bad)}; errors {kinds}')

asyncio.run(main())
