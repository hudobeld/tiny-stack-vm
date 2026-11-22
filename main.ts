// Tiny stack VM for make.fun's tiny-stack-vm-01 (ISA v1). Node 22, stdlib only.
// Runs every /input/<id>/program.bin on its input.bin and writes
// /output/<id>/stdout.bin + /output/<id>/exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const enc = new TextEncoder();

function run(p, q) {
  const D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cs = 0, ol = 0, ip = 0, pc = 0, st = 0;
  const n = p.length;
  const fin = c => ({ o: out.subarray(0, ol), c });
  // One step, in ISA.md's order: step limit (10), pc range (9), unknown opcode (5),
  // immediate cut off (9), then stack underflow (2) / overflow (3), then the
  // instruction's own traps, then its effect. A trap keeps the output so far.
  for (;;) {
    if (st === 1e6) return fin(10); // step limit
    if (pc < 0 || pc >= n) return fin(9); // pc outside the program
    const op = p[pc];
    const bin = (op >= 0x10 && op <= 0x16) || (op >= 0x18 && op <= 0x1a) || (op >= 0x1c && op <= 0x1e) || (op >= 0x20 && op <= 0x22);
    const ok = op <= 7 || bin || op === 0x17 || op === 0x1b || (op >= 0x30 && op <= 0x34) || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53);
    if (!ok) return fin(5); // unknown opcode
    const im = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    if (pc + im >= n) return fin(9); // immediate cut off by the program's end
    const po = op === 7 ? 3 : op === 5 || op === 6 || bin || op === 0x41 ? 2 : (op === 3 || op === 4 || op === 0x17 || op === 0x1b || op === 0x31 || op === 0x32 || op === 0x40 || op === 0x50 || op === 0x51 || op === 0x53) ? 1 : 0;
    const pu = op === 6 || op === 7 ? 3 : op === 4 || op === 5 ? 2 : (op === 1 || op === 2 || bin || op === 0x17 || op === 0x1b || op === 0x40 || op === 0x52) ? 1 : 0;
    st++;
    const nx = pc + 1 + im;
    if (sp < po) return fin(2); // stack underflow
    if (sp - po + pu > 256) return fin(3); // stack overflow
    pc = nx;
    switch (op) {
      case 0x00: return fin(0); // HALT
      case 0x01: D[sp++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break; // PUSH32
      case 0x03: sp--; break; // POP
      case 0x04: D[sp] = D[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; } // SWAP
      case 0x06: D[sp] = D[sp - 2]; sp++; break; // OVER
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; } // ROT
      case 0x17: D[sp - 1] = (-D[sp - 1]) | 0; break; // NEG (wraps: -INT_MIN is INT_MIN)
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break; // NOT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return fin(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return fin(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return fin(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return fin(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        const take = op === 0x30 || (op === 0x31 ? D[--sp] === 0 : D[--sp] !== 0);
        if (take) pc = nx + rel;
        break;
      }
      case 0x33: // CALL
        if (cs === 64) return fin(7);
        C[cs++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34: // RET
        if (cs === 0) return fin(8);
        pc = C[--cs];
        break;
      case 0x40: { // LOAD
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return fin(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: { // STORE: ( v addr -- ), addr is the top
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr >= 256) return fin(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no newline; over the output limit writes nothing
        const bytes = enc.encode(String(D[sp - 1]));
        if (ol + bytes.length > 65536) return fin(11);
        sp--;
        out.set(bytes, ol);
        ol += bytes.length;
        break;
      }
      case 0x51: // PUTC
        if (ol + 1 > 65536) return fin(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < q.length ? q[ip++] : -1; break; // IN (-1 once exhausted)
      case 0x53: return fin(D[--sp] & 255); // EXIT: low byte
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), r.c + '\n');
}
