# Root-only passive capture on eth0 (no packages needed): who rejects our new TCP connections?
# Counts outbound SYNs per second, inbound RSTs and ICMP unreachables (with the original destination), for N seconds.
import socket, struct, sys, time, collections
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 60
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.ntohs(3))
s.bind(('eth0', 0)); s.settimeout(0.5)
me = None
syn_per_s = collections.Counter(); syn_dst = collections.Counter()
rst = collections.Counter(); icmp = collections.Counter(); events = []; timeline = []
t0 = time.time()
def ip4(b): return socket.inet_ntoa(b)
while time.time() - t0 < dur:
    try:
        pkt, addr = s.recvfrom(65535)
    except socket.timeout:
        continue
    outgoing = addr[2] == socket.PACKET_OUTGOING
    if len(pkt) < 34 or pkt[12:14] != b'\x08\x00':
        continue
    ip = pkt[14:]; ihl = (ip[0] & 15) * 4; proto = ip[9]; src, dst = ip4(ip[12:16]), ip4(ip[16:20])
    sec = int(time.time() - t0)
    if proto == 6 and len(ip) >= ihl + 14:
        sp, dp = struct.unpack('!HH', ip[ihl:ihl + 4]); flags = ip[ihl + 13]
        if outgoing and flags & 0x02 and not flags & 0x10:
            syn_per_s[sec] += 1; syn_dst[(dst, dp)] += 1
        elif not outgoing and flags & 0x04:
            rst[(src, sp)] += 1
            timeline.append((round(time.time(),2), 'RST', src, sp, dp))
            if len(events) < 25: events.append(f'{sec:4d}s RST from {src}:{sp} to port {dp} ttl={ip[8]}')
    elif proto == 1 and not outgoing and len(ip) >= ihl + 8 + 20:
        typ, code = ip[ihl], ip[ihl + 1]
        if typ == 3:
            inner = ip[ihl + 8:]; iihl = (inner[0] & 15) * 4
            odst = ip4(inner[16:20]); odp = struct.unpack('!H', inner[iihl + 2:iihl + 4])[0] if len(inner) >= iihl + 4 else 0
            icmp[(src, code)] += 1
            timeline.append((round(time.time(),2), 'ICMP%d' % code, src, odst, odp, ip[8]))
            if len(events) < 25: events.append(f'{sec:4d}s ICMP unreachable code {code} from {src} (ttl={ip[8]}) for {odst}:{odp}')
n = max(1, int(dur))
print(f'outbound SYNs: total {sum(syn_per_s.values())}, avg {sum(syn_per_s.values())/n:.1f}/s, max {max(syn_per_s.values() or [0])}/s')
print('busiest SYN destinations:', syn_dst.most_common(6))
print('inbound RST by source:', rst.most_common(6))
print('ICMP unreachable by (source, code):', icmp.most_common(6))
print('\n'.join(events))

import json
json.dump({'t0': t0, 'syn_per_s': syn_per_s, 'timeline': timeline}, open('/tmp/sniff.json', 'w'))
