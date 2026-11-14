// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Pipeable.js
var e = (e, t) => {
	switch (t.length) {
		case 0: return e;
		case 1: return t[0](e);
		case 2: return t[1](t[0](e));
		case 3: return t[2](t[1](t[0](e)));
		case 4: return t[3](t[2](t[1](t[0](e))));
		case 5: return t[4](t[3](t[2](t[1](t[0](e)))));
		case 6: return t[5](t[4](t[3](t[2](t[1](t[0](e))))));
		case 7: return t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))));
		case 8: return t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e))))))));
		case 9: return t[8](t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))))));
		default: {
			let n = e;
			for (let e = 0, r = t.length; e < r; e++) n = t[e](n);
			return n;
		}
	}
}, t = { pipe() {
	return e(this, arguments);
} }, n = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = t, e;
}(), r = function(e, t) {
	if (typeof e == "function") return function() {
		return e(arguments) ? t.apply(this, arguments) : (e) => t(e, ...arguments);
	};
	switch (e) {
		case 0:
		case 1: throw RangeError(`Invalid arity ${e}`);
		case 2: return function(e, n) {
			return arguments.length >= 2 ? t(e, n) : function(n) {
				return t(n, e);
			};
		};
		case 3: return function(e, n, r) {
			return arguments.length >= 3 ? t(e, n, r) : function(r) {
				return t(r, e, n);
			};
		};
		default: return function() {
			if (arguments.length >= e) return t.apply(this, arguments);
			let n = arguments;
			return function(e) {
				return t(e, ...n);
			};
		};
	}
}, i = (e) => e, a = (e) => () => e, o = /*#__PURE__*/ a(!0), s = /*#__PURE__*/ a(void 0), c = s;
function l(e) {
	let t = /* @__PURE__ */ new WeakMap();
	return (n) => {
		let r = t.get(n);
		if (r !== void 0) return r;
		let i = e(n);
		return t.set(n, i), i;
	};
}
function u(e) {
	let t = /* @__PURE__ */ new WeakMap();
	return (n) => {
		let r = t.get(n);
		if (r !== void 0) return r;
		let i = e(n);
		return t.set(n, i), i !== n && t.set(i, i), i;
	};
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/equal.js
var d = (e) => {
	let t = new Set(Reflect.ownKeys(e));
	if (e.constructor === Object) return t;
	e instanceof Error && t.delete("stack");
	let n = Object.getPrototypeOf(e), r = n;
	for (; r !== null && r !== Object.prototype;) {
		let e = Reflect.ownKeys(r);
		for (let n = 0; n < e.length; n++) t.add(e[n]);
		r = Object.getPrototypeOf(r);
	}
	return t.has("constructor") && typeof e.constructor == "function" && n === e.constructor.prototype && t.delete("constructor"), t;
}, f = /*#__PURE__*/ new WeakSet(), p = (e) => new Uint8Array(e.buffer, e.byteOffset, e.byteLength), m = 0, ee = () => {
	m++;
};
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Predicate.js
function te(e) {
	return typeof e == "string";
}
function ne(e) {
	return typeof e == "number";
}
function re(e) {
	return typeof e == "boolean";
}
function ie(e) {
	return typeof e == "function";
}
function ae(e) {
	return e != null;
}
function oe(e) {
	return !0;
}
function se(e) {
	return typeof e == "object" && !!e || ie(e);
}
var h = /*#__PURE__*/ r(2, (e, t) => se(e) && t in e), g = "~effect/Hash", _ = (e) => {
	switch (typeof e) {
		case "number": return de(e);
		case "bigint": return b(e.toString(10));
		case "string": return b(e);
		case "function":
		case "object":
			if (e === null) break;
			if (e instanceof Date) return Number.isNaN(e.getTime()) ? b("Invalid Date") : b(e.toISOString());
			if (e instanceof RegExp) return b(e.toString());
			{
				if (f.has(e)) return ce(e);
				let t = be.get(e);
				if (t !== void 0) return t;
				if (xe.has(e)) return ee(), b("[Circular]");
				xe.add(e);
				let n = m, r;
				try {
					r = "~effect/Hash" in e ? e[g]() : typeof e == "function" ? ce(e) : e instanceof DataView ? he(p(e)) : Array.isArray(e) || ArrayBuffer.isView(e) ? he(e) : e instanceof Map ? ge(e) : e instanceof Set ? ve(e) : pe(e);
				} finally {
					xe.delete(e);
				}
				return n === m && be.set(e, r), r;
			}
	}
	return y(le(b(String(e))));
}, ce = (e) => (ye.has(e) || ye.set(e, y(Math.random() * 4294967296 | 0)), ye.get(e)), le = (e) => (e ^= e >>> 16, e = Math.imul(e, 2246822507), e ^= e >>> 13, e = Math.imul(e, 3266489909), e ^ e >>> 16), v = /*#__PURE__*/ r(2, (e, t) => le(Math.imul(e, 2654435761) + Math.imul(t, 2246822507))), y = (e) => e & 3221225471 | e >>> 1 & 1073741824, ue = /*#__PURE__*/ new DataView(/*#__PURE__*/ new ArrayBuffer(8)), de = (e) => {
	let t = e | 0;
	return t === e ? y(t) : (ue.setFloat64(0, e === e ? e : NaN), y(v(ue.getInt32(0), ue.getInt32(4))));
}, b = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return y(t);
}, fe = (e, t) => {
	let n = 12289;
	for (let r of t) n ^= v(_(r), _(e[r]));
	return y(n);
}, pe = (e) => fe(e, d(e)), me = (e, t) => (n) => {
	let r = e;
	for (let e of n) r ^= t(e);
	return y(r);
}, he = (e) => {
	let t = 6151;
	for (let n of e) t = v(t, _(n));
	return y(t);
}, ge = /*#__PURE__*/ me(/*#__PURE__*/ b("Map"), ([e, t]) => v(_(e), _(t))), _e = /*#__PURE__*/ b("Set"), ve = /*#__PURE__*/ me(_e, (e) => v(_e, _(e))), ye = /*#__PURE__*/ new WeakMap(), be = /*#__PURE__*/ new WeakMap(), xe = /*#__PURE__*/ new WeakSet(), x = "~effect/Equal";
function S() {
	return arguments.length === 1 ? (e) => Se(e, arguments[0]) : Se(arguments[0], arguments[1]);
}
function Se(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = typeof e;
	return n === typeof t ? n === "number" && e !== e && t !== t ? !0 : n !== "object" && n !== "function" || f.has(e) || f.has(t) ? !1 : Ce(e, t) : !1;
}
function Ce(e, t) {
	let n = Te.length;
	for (let r = n; r-- > 0;) if (Te[r] === e && Ee[r] === t) return !0;
	if (n) return we(e, t);
	let r = De.get(e);
	r || De.set(e, r = /* @__PURE__ */ new WeakMap());
	let i = r.get(t);
	return i === void 0 && r.set(t, i = we(e, t)), i;
}
function we(e, t) {
	Te.push(e), Ee.push(t);
	try {
		return Oe(e, t);
	} finally {
		Te.pop(), Ee.pop();
	}
}
var Te = [], Ee = [], De = /*#__PURE__*/ new WeakMap();
function Oe(e, t) {
	if (_(e) !== _(t)) return !1;
	if (e instanceof Date) {
		if (!(t instanceof Date)) return !1;
		let n = e.getTime(), r = t.getTime();
		return n === r || Number.isNaN(n) && Number.isNaN(r);
	}
	if (e instanceof RegExp) return t instanceof RegExp && e.toString() === t.toString();
	let n = Fe(e);
	if (n !== Fe(t) || typeof e == "function" && !n) return !1;
	if (n) return e[x](t);
	if (Array.isArray(e)) return !Array.isArray(t) || e.length !== t.length ? !1 : ke(e, t);
	if (ArrayBuffer.isView(e)) {
		let n = e instanceof DataView;
		return !ArrayBuffer.isView(t) || e.byteLength !== t.byteLength || n !== t instanceof DataView ? !1 : n ? Ae(p(e), p(t)) : Ae(e, t);
	}
	return e instanceof Map ? !(t instanceof Map) || e.size !== t.size ? !1 : Me(e, t, Ne, Pe) : e instanceof Set ? !(t instanceof Set) || e.size !== t.size ? !1 : Me(e, t, _, Se) : je(e, t);
}
function ke(e, t) {
	for (let n = 0; n < e.length; n++) if (!Se(e[n], t[n])) return !1;
	return !0;
}
function Ae(e, t) {
	if (e.length !== t.length) return !1;
	for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
function je(e, t) {
	let n = d(e), r = d(t);
	if (n.size !== r.size) return !1;
	for (let i of n) if (!r.has(i) || !Se(e[i], t[i])) return !1;
	return !0;
}
function Me(e, t, n, r) {
	let i = /* @__PURE__ */ new Map(), a = 0;
	for (let e of t) {
		let t = n(e), r = i.get(t);
		r ? r.push(e) : i.set(t, [e]), a++;
	}
	outer: for (let t of e) {
		let e = i.get(n(t));
		if (e) {
			for (let n = 0; n < e.length; n++) if (r(t, e[n])) {
				e[n] = e[e.length - 1], e.pop(), a--;
				continue outer;
			}
		}
		return !1;
	}
	return a === 0;
}
var Ne = (e) => _(e[0]), Pe = (e, t) => Se(e[0], t[0]) && Se(e[1], t[1]), Fe = (e) => h(e, x), Ie = (e) => e.length > 0;
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/record.js
function Le(e, t, n) {
	t === "__proto__" ? Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n;
}
function Re(e, t) {
	for (let n of Reflect.ownKeys(t)) Object.prototype.propertyIsEnumerable.call(t, n) && Le(e, n, t[n]);
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Redactable.js
var ze = /*#__PURE__*/ Symbol.for("~effect/Redactable"), Be = (e) => h(e, ze);
function Ve(e) {
	return Be(e) ? He(e) : e;
}
function He(e) {
	return e[ze](globalThis["~effect/Fiber/currentFiber"]?.context ?? Ge);
}
var Ue = "~effect/Fiber/currentFiber", We = /*#__PURE__*/ new Map(), Ge = {
	"~effect/Context": {},
	base: We,
	depth: 0,
	mapUnsafe: We,
	pipe() {
		return e(this, arguments);
	}
};
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Formatter.js
function C(e, t) {
	let n = t?.space ?? 0, r = /* @__PURE__ */ new WeakSet(), i = n ? typeof n == "number" ? " ".repeat(n) : n : "", a = (e) => i.repeat(e), o = (e, t) => {
		let n = e?.constructor;
		return n && n !== Object.prototype.constructor && n.name ? `${n.name}(${t})` : t;
	}, s = (e) => {
		try {
			return Reflect.ownKeys(e);
		} catch {
			return ["[ownKeys threw]"];
		}
	};
	function c(e, t = 0) {
		try {
			return l(e, t);
		} catch {
			return (typeof e == "object" && e || typeof e == "function") && r.delete(e), "[inspection threw]";
		}
	}
	function l(e, n = 0) {
		if (typeof e == "string") return JSON.stringify(e);
		if (typeof e == "number" || e == null || typeof e == "boolean" || typeof e == "symbol") return String(e);
		if (typeof e == "bigint") return String(e) + "n";
		if (typeof e == "object" || typeof e == "function") {
			if (r.has(e)) return Ke;
			r.add(e);
			let l;
			if (ze in e) l = c(He(e), n);
			else if (Array.isArray(e)) l = !i || e.length <= 1 ? `[${e.map((e) => c(e, n)).join(",")}]` : `[\n${a(n + 1)}${e.map((e) => c(e, n + 1)).join(",\n" + a(n + 1))}\n${a(n)}]`;
			else if (e instanceof Date) l = Ye(e);
			else if (!t?.ignoreToString && h(e, "toString") && typeof e.toString == "function" && e.toString !== Object.prototype.toString && e.toString !== Array.prototype.toString) {
				let t = Xe(e);
				l = e instanceof Error && e.cause !== void 0 ? `${t} (cause: ${c(e.cause, n)})` : t;
			} else if (Symbol.iterator in e) l = `${e.constructor.name}(${c(Array.from(e), n)})`;
			else {
				let t = s(e);
				if (!i || t.length <= 1) {
					let r = `{${t.map((t) => `${qe(t)}:${c(Ze(e, t), n)}`).join(",")}}`;
					l = o(e, r);
				} else {
					let r = `{\n${t.map((t) => `${a(n + 1)}${qe(t)}: ${c(Ze(e, t), n + 1)}`).join(",\n")}\n${a(n)}}`;
					l = o(e, r);
				}
			}
			return r.delete(e), l;
		}
		return String(e);
	}
	return c(e, 0);
}
var Ke = "[Circular]";
function qe(e) {
	return typeof e == "string" ? JSON.stringify(e) : String(e);
}
function Je(e) {
	return e.map((e) => `[${qe(e)}]`).join("");
}
function Ye(e) {
	try {
		return e.toISOString();
	} catch {
		return "Invalid Date";
	}
}
function Xe(e) {
	try {
		let t = e.toString();
		return typeof t == "string" ? t : String(t);
	} catch {
		return "[toString threw]";
	}
}
function Ze(e, t) {
	try {
		return e[t];
	} catch {
		return "[property access threw]";
	}
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Inspectable.js
var w = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), Qe = (e) => {
	try {
		return e = Ve(e), h(e, "toJSON") && ie(e.toJSON) && e.toJSON.length === 0 ? e.toJSON() : Array.isArray(e) ? e.map(Qe) : e;
	} catch {
		return "[toJSON threw]";
	}
}, T = {
	toJSON() {
		return Qe(this);
	},
	[w]() {
		return this.toJSON();
	},
	toString() {
		return C(this.toJSON());
	}
}, $e = /*#__PURE__*/ (() => {
	let e = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
	return e === void 0 ? Object.isExtensible(Error) : Object.hasOwn(e, "writable") ? e.writable === !0 : e.set !== void 0;
})(), et = () => Error.stackTraceLimit, tt = (e) => {
	$e && (Error.stackTraceLimit = e);
}, nt = class {
	constructor(e) {
		this.value = e, this.done = !1;
	}
	next(e) {
		return this.done ? (this.value = e, this) : (this.done = !0, {
			value: this.value,
			done: !1
		});
	}
}, rt = /*#__PURE__*/ (() => {
	let e = "~effect/Utils/internal", t = { [e]: (e) => e() }, n = { [e]: (e) => {
		try {
			return e();
		} finally {}
	} }, r = et();
	if (r === 0) return n[e];
	tt(2);
	let i = t[e](() => /* @__PURE__ */ Error());
	return tt(r), i.stack?.includes(e) === !0 ? t[e] : n[e];
})(), it = "~effect/Effect", at = "~effect/Exit", ot = {
	_A: i,
	_E: i,
	_R: i
}, st = `${it}/identifier`, E = `${it}/args`, D = `${it}/evaluate`, O = `${it}/successCont`, k = `${it}/failureCont`, ct = `${it}/ensureCont`, lt = /*#__PURE__*/ Symbol.for("effect/Effect/Yield"), ut = {
	pipe() {
		return e(this, arguments);
	},
	toJSON() {
		return { ...this };
	},
	toString() {
		return C(this.toJSON(), {
			ignoreToString: !0,
			space: 2
		});
	},
	[w]() {
		return this.toJSON();
	}
}, dt = {
	[it]: ot,
	...ut,
	[Symbol.iterator]() {
		return new nt(this);
	},
	toJSON() {
		return {
			_id: "Effect",
			op: this[st],
			..."~effect/Effect/args" in this ? { args: this[E] } : void 0
		};
	}
}, ft = (e) => h(e, at), pt = "~effect/Cause", mt = "~effect/Cause/Reason", ht = (e) => h(e, pt), gt = class {
	constructor(e) {
		this[pt] = pt, this.reasons = e;
	}
	pipe() {
		return e(this, arguments);
	}
	toJSON() {
		return {
			_id: "Cause",
			failures: this.reasons.map((e) => e.toJSON())
		};
	}
	toString() {
		return `Cause(${C(this.reasons)})`;
	}
	[w]() {
		return this.toJSON();
	}
	[x](e) {
		return ht(e) && this.reasons.length === e.reasons.length && this.reasons.every((t, n) => S(t, e.reasons[n]));
	}
	[g]() {
		return he(this.reasons);
	}
}, _t = /*#__PURE__*/ new WeakMap(), vt = class {
	[mt];
	annotations;
	_tag;
	constructor(e, t, n) {
		if (this[mt] = mt, this._tag = e, t !== yt && typeof n == "object" && n && t.size > 0) {
			let e = _t.get(n);
			e && (t = new Map([...e, ...t])), _t.set(n, t);
		}
		this.annotations = t;
	}
	annotate(e, t) {
		if (e.mapUnsafe.size === 0) return this;
		let n = new Map(this.annotations);
		e.mapUnsafe.forEach((e, r) => {
			t?.overwrite !== !0 && n.has(r) || n.set(r, e);
		});
		let r = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
		return r.annotations = n, r;
	}
	pipe() {
		return e(this, arguments);
	}
	toString() {
		return C(this);
	}
	[w]() {
		return this.toString();
	}
}, yt = /*#__PURE__*/ new Map(), bt = class extends vt {
	constructor(e, t = yt) {
		super("Fail", t, e), this.error = e;
	}
	toString() {
		return `Fail(${C(this.error)})`;
	}
	toJSON() {
		return {
			_tag: "Fail",
			error: this.error
		};
	}
	[x](e) {
		return kt(e) && S(this.error, e.error) && S(this.annotations, e.annotations);
	}
	[g]() {
		return v(b(this._tag))(v(_(this.error))(_(this.annotations)));
	}
}, xt = (e) => new gt(e), St = (e, t) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let i of e.concat(t)) {
		let e = _(i), t = n.get(e);
		if (t === void 0) n.set(e, [i]);
		else if (t.some((e) => S(e, i))) continue;
		else t.push(i);
		r.push(i);
	}
	return r;
}, Ct = /*#__PURE__*/ r(2, (e, t) => {
	if (e.reasons.length === 0) return t;
	if (t.reasons.length === 0) return e;
	let n = new gt(St(e.reasons, t.reasons));
	return S(e, n) ? e : n;
}), wt = (e, t) => {
	let n = e.reasons.slice();
	for (let e of t.reasons) jt(e) && !n.some((t) => jt(t) && t.fiberId === e.fiberId && t.annotations === e.annotations) && n.push(e);
	return n.length === e.reasons.length ? e : new gt(n);
}, Tt = (e) => new gt([new bt(e)]), Et = class extends vt {
	constructor(e, t = yt) {
		super("Die", t, e), this.defect = e;
	}
	toString() {
		return `Die(${C(this.defect)})`;
	}
	toJSON() {
		return {
			_tag: "Die",
			defect: this.defect
		};
	}
	[x](e) {
		return At(e) && S(this.defect, e.defect) && S(this.annotations, e.annotations);
	}
	[g]() {
		return v(b(this._tag))(v(_(this.defect))(_(this.annotations)));
	}
}, Dt = (e) => new gt([new Et(e)]), Ot = /*#__PURE__*/ r((e) => ht(e[0]), (e, t, n) => t.mapUnsafe.size === 0 ? e : new gt(e.reasons.map((e) => e.annotate(t, n)))), kt = (e) => e._tag === "Fail", At = (e) => e._tag === "Die", jt = (e) => e._tag === "Interrupt";
function Mt(e) {
	return Rt("Effect.evaluate: Not implemented");
}
var A = (e) => ({
	...dt,
	[st]: e.op,
	[D]: e["~effect/Effect/evaluate"] ?? Mt,
	[O]: e[O],
	[k]: e[k],
	[ct]: e[ct]
}), Nt = (e) => {
	let t = A(e), n = function(e) {
		this[E] = e;
	};
	return n.prototype = t, function(e) {
		return new n(e);
	};
}, Pt = (e) => {
	let t = {
		[at]: at,
		_tag: e.op,
		get [e.prop]() {
			return this[E];
		},
		...A(e),
		toString() {
			return `${e.op}(${C(this[E])})`;
		},
		toJSON() {
			return {
				_id: "Exit",
				_tag: e.op,
				[e.prop]: this[E]
			};
		},
		[x](e) {
			return ft(e) && e._tag === this._tag && S(this["~effect/Effect/args"], e["~effect/Effect/args"]);
		},
		[g]() {
			return v(b(e.op), _(this[E]));
		}
	}, n = function(e) {
		this[E] = e;
	};
	return n.prototype = t, function(e) {
		return new n(e);
	};
}, j = /*#__PURE__*/ Pt({
	op: "Success",
	prop: "value",
	[D](e) {
		let t = e.getCont(O);
		return t ? t[O](this[E], e, this) : e.yieldWith(this);
	}
}), Ft = { key: "effect/Cause/StackTrace" }, It = { key: "effect/Cause/InterruptorStackTrace" }, M = /*#__PURE__*/ Pt({
	op: "Failure",
	prop: "cause",
	[D](e) {
		let t = this[E], n = !1;
		e.cache.stackFrame && (t = Ot(t, { mapUnsafe: /* @__PURE__ */ new Map([[Ft.key, e.cache.stackFrame]]) }), n = !0);
		let r = e.getCont(k), i = e._interruptedCause;
		if (i && e.interruptible) {
			let a = !1;
			for (; r && e.interruptible;) a ||= st in r, r = e.getCont(k);
			a && (t = xt(t.reasons.filter((e) => e._tag !== "Fail"))), t = wt(t, i), n = !0;
		}
		return r ? r[k](t, e, n ? void 0 : this) : e.yieldWith(n ? M(t) : this);
	}
}), Lt = (e) => M(Tt(e)), Rt = (e) => M(Dt(e)), zt = /*#__PURE__*/ Nt({
	op: "WithFiber",
	[D](e) {
		return this[E](e);
	}
}), Bt = /*#__PURE__*/ function() {
	class e extends globalThis.Error {}
	let t = /*#__PURE__*/ A({
		op: "YieldableError",
		[D]() {
			return Lt(this);
		}
	});
	return delete t.toString, Object.assign(e.prototype, t), e;
}(), Vt = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return class extends Bt {
		constructor(t) {
			super(t?.message, t?.cause ? { cause: t.cause } : void 0), t && (Re(this, t), Object.defineProperty(this, e, {
				value: t,
				enumerable: !1
			}));
		}
		toJSON() {
			return {
				...this[e],
				...this
			};
		}
	};
}(), Ht = (e) => {
	class t extends Vt {
		_tag = e;
	}
	return t.prototype.name = e, t;
}, Ut = "~effect/Option", Wt = {
	[Ut]: { _A: (e) => e },
	...ut,
	[Symbol.iterator]() {
		return new nt(this);
	}
}, Gt = /*#__PURE__*/ Object.defineProperty(/*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Wt), {
	_tag: "Some",
	_op: "Some",
	[x](e) {
		return Jt(e) && Xt(e) && S(this.value, e.value);
	},
	[g]() {
		return v(_(this._tag))(_(this.value));
	},
	toString() {
		return `some(${C(this.value)})`;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: Qe(this.value)
		};
	}
}), "valueOrUndefined", { get() {
	return this.value;
} }), Kt = /*#__PURE__*/ _("None"), qt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Wt), {
	_tag: "None",
	_op: "None",
	valueOrUndefined: void 0,
	[x](e) {
		return Jt(e) && Yt(e);
	},
	[g]() {
		return Kt;
	},
	toString() {
		return "none()";
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), Jt = (e) => h(e, Ut), Yt = (e) => e._tag === "None", Xt = (e) => e._tag === "Some", Zt = /*#__PURE__*/ Object.create(qt), Qt = function(e) {
	this.value = e;
};
Qt.prototype = Gt;
var $t = (e) => new Qt(e), en = "~effect/Result", tn = {
	[en]: {
		/* v8 ignore next 2 */
		_A: (e) => e,
		_E: (e) => e
	},
	...ut,
	[Symbol.iterator]() {
		return new nt(this);
	}
}, nn = (e) => h(e, en), rn = (e) => e._tag === "Failure", an = (e) => e._tag === "Success";
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Order.js
function on(e) {
	return (t, n) => t === n ? 0 : e(t, n);
}
var sn = /*#__PURE__*/ on((e, t) => e < t ? -1 : 1), cn = /*#__PURE__*/ on((e, t) => globalThis.Number.isNaN(e) && globalThis.Number.isNaN(t) ? 0 : globalThis.Number.isNaN(e) ? -1 : globalThis.Number.isNaN(t) ? 1 : e < t ? -1 : 1), ln = (e) => r(2, (t, n) => e(t, n) === -1), un = (e) => r(2, (t, n) => e(t, n) === 1), dn = (e) => r(2, (t, n) => e(t, n) !== 1), fn = (e) => r(2, (t, n) => e(t, n) !== -1), pn = () => Zt, mn = $t, hn = globalThis.Array, gn = /*#__PURE__*/ r(2, (e, t) => [...e, t]);
hn.isArray;
var _n = Ie, vn = Ie, yn = () => [], bn = /*#__PURE__*/ r(2, (e, t) => e.map(t)), xn = "~effect/BigDecimal", Sn = {
	[xn]: xn,
	[g]() {
		let e = kn(this);
		return v(b(String(e.value)), de(e.scale));
	},
	[x](e) {
		return Cn(e) && Pn(this, e) === 0;
	},
	toString() {
		return `BigDecimal(${In(this)})`;
	},
	toJSON() {
		return {
			_id: "BigDecimal",
			value: String(this.value),
			scale: this.scale
		};
	},
	[w]() {
		return this.toJSON();
	},
	pipe() {
		return e(this, arguments);
	}
}, Cn = (e) => h(e, xn), wn = (e, t) => {
	if (!Number.isSafeInteger(t)) throw RangeError(`Scale must be a safe integer, got ${t}`);
	let n = Object.create(Sn);
	return n.value = e, n.scale = t, n;
}, Tn = (e, t) => {
	let n = wn(e, t);
	return n.normalized = n, n;
}, N = /*#__PURE__*/ BigInt(0), En = /*#__PURE__*/ BigInt(1), Dn = /*#__PURE__*/ BigInt(10), On = /*#__PURE__*/ Tn(N, 0), kn = (e) => {
	if (e.normalized === void 0) {
		if (e.value === N) e.normalized = On;
		else {
			let t = `${e.value}`, n = t.length;
			for (; t[n - 1] === "0";) n--;
			e.normalized = Tn(BigInt(t.slice(0, n)), e.scale - (t.length - n));
		}
	}
	return e.normalized;
}, An = 100, jn = [En], Mn = (e, t) => e === t ? 0 : e < t ? -1 : 1, Nn = (e, t) => {
	let n = `${e.value < N ? -e.value : e.value}`, r = `${t.value < N ? -t.value : t.value}`, i = BigInt(n.length - r.length) - BigInt(e.scale) + BigInt(t.scale);
	if (i !== N) return i < N ? -1 : 1;
	let a = Math.max(n.length, r.length);
	return sn(n.padEnd(a, "0"), r.padEnd(a, "0"));
}, Pn = (e, t) => {
	if (e.scale === t.scale) return Mn(e.value, t.value);
	let n = Fn(e), r = Fn(t);
	if (n !== r) return n < r ? -1 : 1;
	if (n === 0) return 0;
	let i = e.scale - t.scale, a = Math.abs(i);
	if (a > An) return n === -1 ? Nn(t, e) : Nn(e, t);
	let o = jn[a] ??= Dn ** BigInt(a);
	return i > 0 ? Mn(e.value, t.value * o) : Mn(e.value * o, t.value);
}, Fn = (e) => e.value === N ? 0 : e.value < N ? -1 : 1, In = (e) => {
	let t = kn(e);
	if (Math.abs(t.scale) >= 16) return Ln(t);
	let n = t.value < N, r = `${n ? -t.value : t.value}`, i = t.scale > 0 ? r.padStart(t.scale + 1, "0") : r.padEnd(r.length - t.scale, "0"), a = i.length - t.scale, o = t.scale > 0 ? `${i.slice(0, a)}.${i.slice(a)}` : i;
	return n ? `-${o}` : o;
}, Ln = (e) => {
	if (Rn(e)) return "0e+0";
	let t = kn(e), n = `${t.value}`, r = t.value < N ? 2 : 1, i = n.slice(0, r), a = n.slice(r), o = a.length - t.scale;
	return `${i}${a === "" ? "" : `.${a}`}e${o >= 0 ? "+" : ""}${o}`;
}, Rn = (e) => e.value === N, zn = (e) => A({
	op: e.label,
	[D]: e.evaluate
}), Bn = "~effect/Context/Service", Vn = function() {
	function e() {}
	let t = e;
	Object.setPrototypeOf(t, Hn);
	let n = (e, n) => (t.key = e, n?.defaultValue && (t[Wn] = Wn, t.defaultValue = n.defaultValue), n?.make && (t.make = n.make), n?.fiberCached && Un.add(e), t);
	return arguments.length > 0 ? n(arguments[0], arguments[1]) : n;
}, Hn = {
	[Bn]: Bn,
	.../*#__PURE__*/ zn({
		label: "Service",
		evaluate(e) {
			return j(P(e.context, this));
		}
	}),
	toJSON() {
		return {
			_id: "Service",
			key: this.key
		};
	},
	of(e) {
		return e;
	},
	context(e) {
		return or(this, e);
	},
	use(e) {
		return zt((t) => e(P(t.context, this)));
	},
	useSync(e) {
		return zt((t) => j(e(P(t.context, this))));
	}
}, Un = /*#__PURE__*/ new Set(), Wn = "~effect/Context/Reference", Gn = "~effect/Context", Kn = 8, qn = 8, Jn = (e, t, n, r) => {
	let i = Object.create(er);
	return i.cacheRoot = e ?? i, i.base = t, i.overlay = n, i.depth = r, i._flat = void 0, i.baseHits = 0, i;
}, Yn = (e, t) => {
	t && (Yn(e, t.parent), e.set(t.key, t.value));
}, Xn = (e) => {
	if (e._flat) return e._flat;
	if (!e.overlay) return e._flat = e.base;
	let t = new Map(e.base);
	return Yn(t, e.overlay), e._flat = t;
}, Zn = /*#__PURE__*/ Symbol(), Qn = (e, t) => {
	let n = e;
	for (let e = n.overlay; e; e = e.parent) if (e.key === t) return e.value;
	let r = n.base.get(t);
	return r === void 0 && !n.base.has(t) ? Zn : (n.overlay && ++n.baseHits >= n.base.size && n.baseHits >= qn && (n.base = Xn(n), n.overlay = void 0, n.depth = 0), r);
}, $n = (e) => Jn(void 0, e, void 0, 0), er = {
	get mapUnsafe() {
		return Xn(this);
	},
	...ut,
	[Gn]: { _Services: (e) => e },
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.mapUnsafe).map(([e, t]) => ({
				key: e,
				value: t
			}))
		};
	},
	[x](e) {
		if (!nr(e)) return !1;
		let t = this.mapUnsafe, n = e.mapUnsafe;
		if (t.size !== n.size) return !1;
		for (let [e, r] of t) if (!n.has(e) || !S(r, n.get(e))) return !1;
		return !0;
	},
	[g]() {
		return de(this.mapUnsafe.size);
	}
}, tr = (e, t) => e.cacheRoot === t.cacheRoot, nr = (e) => h(e, Gn), rr = (e) => !!e[Wn], ir = () => ar, ar = /*#__PURE__*/ $n(/*#__PURE__*/ new Map()), or = (e, t) => $n(/* @__PURE__ */ new Map([[e.key, t]])), sr = /*#__PURE__*/ r(3, (e, t, n) => cr(e, t.key, n)), cr = (e, t, n) => {
	let r = e, i = Un.has(t) ? void 0 : r.cacheRoot;
	if (r.depth >= Kn) {
		let e = new Map(r._flat ?? r.base);
		return r._flat || Yn(e, r.overlay), e.set(t, n), Jn(i, e, void 0, 0);
	}
	return Jn(i, r.base, {
		key: t,
		value: n,
		parent: r.overlay
	}, r.depth + 1);
}, lr = (e, t) => {
	let n = Qn(e, t);
	return n === Zn ? void 0 : n;
}, P = /* @__PURE__ */ r(2, (e, t) => {
	let n = Qn(e, t.key);
	if (n === Zn) {
		if (rr(t)) return dr(t);
		throw fr(t);
	}
	return n;
}), ur = "~effect/Context/defaultValue", dr = (e) => ur in e ? e[ur] : e[ur] = e.defaultValue(), fr = (e) => {
	let t = /* @__PURE__ */ Error(`Service not found${e.key ? `: ${String(e.key)}` : ""}`);
	if (t.stack) {
		let e = t.stack.split("\n");
		e.splice(1, 3), t.stack = e.join("\n");
	}
	return t;
}, pr = Vn, mr = "~effect/Duration", hr = /*#__PURE__*/ BigInt(0), gr = /*#__PURE__*/ BigInt(1), _r = /*#__PURE__*/ BigInt(2), vr = /*#__PURE__*/ BigInt(10), yr = /*#__PURE__*/ BigInt(1e3), br = /*#__PURE__*/ BigInt(1e6), xr = (e) => BigInt(Math.sign(e) * Math.round(Math.abs(e))), Sr = (e) => Number.isInteger(e) ? BigInt(e) * br : xr(e * 1e6), Cr = (e) => F(Number.isFinite(e) ? xr(e) : e), wr = (e, t) => {
	let n = e.indexOf(".");
	if (n === -1) return BigInt(e) * t;
	let r = e[0] === "-", i = e.slice(n + 1), a = vr ** BigInt(i.length), o = (BigInt(e.slice(+!!r, n)) * a + BigInt(i)) * t;
	return Tr(r ? -o : o, a);
}, Tr = (e, t) => {
	let n = e < hr ? -e : e, r = n / t + (n % t * _r >= t ? gr : hr);
	return e < hr ? -r : r;
}, Er = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Dr = (e) => {
	switch (typeof e) {
		case "number": return Rr(e);
		case "bigint": return Lr(e);
		case "string": {
			if (e === "Infinity") return Fr;
			if (e === "-Infinity") return Ir;
			let t = Er.exec(e);
			if (!t) break;
			let [n, r, i] = t;
			if (i === "nano" || i === "nanos") return Lr(wr(r, gr));
			if (i === "micro" || i === "micros") return Lr(wr(r, yr));
			let a = Number(r);
			switch (i) {
				case "milli":
				case "millis": return Rr(a);
				case "second":
				case "seconds": return zr(a);
				case "minute":
				case "minutes": return Br(a);
				case "hour":
				case "hours": return Vr(a);
				case "day":
				case "days": return Hr(a);
				case "week":
				case "weeks": return Ur(a);
			}
			break;
		}
		case "object": {
			if (e === null) break;
			if (mr in e) return e;
			if (Array.isArray(e)) return e.length !== 2 || !e.every(ne) ? Or(e) : Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Pr : e[0] === -Infinity || e[1] === -Infinity ? Ir : e[0] === Infinity || e[1] === Infinity ? Fr : Cr(e[0] * 1e9 + e[1]);
			let t = e, n = 0;
			return t.weeks && (n += t.weeks * 6048e5), t.days && (n += t.days * 864e5), t.hours && (n += t.hours * 36e5), t.minutes && (n += t.minutes * 6e4), t.seconds && (n += t.seconds * 1e3), t.milliseconds && (n += t.milliseconds), !t.microseconds && !t.nanoseconds ? F(n) : Cr(n * 1e6 + (t.microseconds ?? 0) * 1e3 + (t.nanoseconds ?? 0));
		}
	}
	return Or(e);
}, Or = (e) => {
	throw Error(`Invalid Input: ${e}`);
}, kr = {
	_tag: "Millis",
	millis: 0
}, Ar = { _tag: "Infinity" }, jr = { _tag: "NegativeInfinity" }, Mr = {
	[mr]: mr,
	[g]() {
		switch (this.value._tag) {
			case "Millis": return _(Sr(this.value.millis));
			case "Nanos": return _(this.value.nanos);
			default: return pe(this.value);
		}
	},
	[x](e) {
		return Nr(e) && qr(this, e);
	},
	toString() {
		switch (this.value._tag) {
			case "Infinity": return "Infinity";
			case "NegativeInfinity": return "-Infinity";
			case "Nanos": return `${this.value.nanos} nanos`;
			case "Millis": return `${this.value.millis} millis`;
		}
	},
	toJSON() {
		switch (this.value._tag) {
			case "Millis": return {
				_id: "Duration",
				_tag: "Millis",
				millis: this.value.millis
			};
			case "Nanos": return {
				_id: "Duration",
				_tag: "Nanos",
				nanos: String(this.value.nanos)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
			case "NegativeInfinity": return {
				_id: "Duration",
				_tag: "NegativeInfinity"
			};
		}
	},
	[w]() {
		return this.toJSON();
	},
	pipe() {
		return e(this, arguments);
	}
}, F = (e) => {
	let t = Object.create(Mr);
	return t.value = typeof e == "number" ? isNaN(e) || e === 0 || Object.is(e, -0) ? kr : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: Sr(e)
	} : e > 0 ? Ar : jr : e === hr ? kr : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Nr = (e) => h(e, mr), Pr = /*#__PURE__*/ F(0), Fr = /*#__PURE__*/ F(Infinity), Ir = /*#__PURE__*/ F(-Infinity), Lr = (e) => F(e), Rr = (e) => F(e), zr = (e) => F(e * 1e3), Br = (e) => F(e * 6e4), Vr = (e) => F(e * 36e5), Hr = (e) => F(e * 864e5), Ur = (e) => F(e * 6048e5), Wr = (e) => {
	let t = Dr(e);
	switch (t.value._tag) {
		case "Infinity":
		case "NegativeInfinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return Sr(t.value.millis);
	}
}, Gr = /*#__PURE__*/ r(3, (e, t, n) => e.value._tag === "Infinity" || e.value._tag === "NegativeInfinity" || t.value._tag === "Infinity" || t.value._tag === "NegativeInfinity" ? n.onInfinity(e, t) : e.value._tag === "Millis" ? t.value._tag === "Millis" ? n.onMillis(e.value.millis, t.value.millis) : n.onNanos(Wr(e), t.value.nanos) : n.onNanos(e.value.nanos, Wr(t))), Kr = (e, t) => Gr(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t,
	onInfinity: (e, t) => e.value._tag === t.value._tag
}), qr = /*#__PURE__*/ r(2, (e, t) => Kr(e, t)), Jr = /*#__PURE__*/ pr("effect/Scheduler", {
	fiberCached: !0,
	defaultValue: () => new $r()
}), Yr = (e) => {
	let t = !1;
	return Promise.resolve().then(() => {
		t || e();
	}), () => {
		t = !0;
	};
}, Xr = "setImmediate" in globalThis ? (e) => {
	let t = globalThis.setImmediate(e);
	return () => globalThis.clearImmediate(t);
} : (e) => {
	let t = setTimeout(e, 0);
	return () => clearTimeout(t);
}, Zr = (e) => {
	try {
		return Xr(e);
	} catch {
		return Yr(e);
	}
}, Qr = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets, r = n.length, i, a = 0;
		for (; a < r && !(n[a][0] > t); a++) i = n[a];
		i && i[0] === t ? i[1].push(e) : a === r ? n.push([t, [e]]) : n.splice(a, 0, [t, [e]]);
	}
	drain() {
		let e = this.buckets;
		return this.buckets = [], e;
	}
}, $r = class {
	executionMode;
	setImmediate;
	constructor(e = "async", t) {
		this.executionMode = e, this.setImmediate = t ?? (e === "sync" ? Yr : Zr);
	}
	shouldYield(e) {
		return e.currentOpCount >= e.cache.maxOpsBeforeYield;
	}
	makeDispatcher() {
		return new ei(this.setImmediate);
	}
}, ei = class {
	tasks = /*#__PURE__*/ new Qr();
	running = void 0;
	setImmediate;
	constructor(e = Zr) {
		this.setImmediate = e;
	}
	scheduleTask(e, t) {
		this.tasks.scheduleTask(e, t), this.running === void 0 && (this.running = this.setImmediate(this.afterScheduled));
	}
	afterScheduled = () => {
		this.running = void 0, this.runTasks();
	};
	runTasks() {
		let e = this.tasks.drain();
		for (let t = 0; t < e.length; t++) {
			let n = e[t][1];
			for (let e = 0; e < n.length; e++) n[e]();
		}
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) this.running !== void 0 && (this.running(), this.running = void 0), this.runTasks();
	}
}, ti = /*#__PURE__*/ pr("effect/Scheduler/MaxOpsBeforeYield", {
	fiberCached: !0,
	defaultValue: () => 2048
}), ni = /*#__PURE__*/ pr("effect/Scheduler/PreventSchedulerYield", {
	fiberCached: !0,
	defaultValue: () => !1
}), ri = Ht, ii = "effect/Tracer/ParentSpan", ai = "effect/Tracer", oi = "effect/Metric/FiberRuntimeMetrics", si = /*#__PURE__*/ pr("effect/References/CurrentStackFrame", {
	fiberCached: !0,
	defaultValue: s
}), ci = /*#__PURE__*/ pr("effect/References/TracerEnabled", {
	fiberCached: !0,
	defaultValue: o
}), li = /*#__PURE__*/ pr("effect/References/CurrentLogLevel", {
	fiberCached: !0,
	defaultValue: () => "Info"
}), ui = /*#__PURE__*/ pr("effect/References/MinimumLogLevel", {
	fiberCached: !0,
	defaultValue: () => "Info"
}), di = class extends vt {
	constructor(e, t = yt) {
		super("Interrupt", t, "Interrupted"), this.fiberId = e;
	}
	toString() {
		return `Interrupt(${this.fiberId})`;
	}
	toJSON() {
		return {
			_tag: "Interrupt",
			fiberId: this.fiberId
		};
	}
	[x](e) {
		return jt(e) && this.fiberId === e.fiberId && this.annotations === e.annotations;
	}
	[g]() {
		return b(`${this._tag}:${this.fiberId}`);
	}
}, fi = (e) => new gt([new di(e)]), pi = (e) => e.reasons.some(jt), mi = /*#__PURE__*/ r(2, (e, t) => {
	let n = !1, r = e.reasons.map((e) => kt(e) ? (n = !0, new bt(t(e.error), e.annotations)) : e);
	return n ? xt(r) : e;
}), hi = "~effect/Fiber", gi = {
	_A: i,
	_E: i
}, _i = { id: 0 }, vi = /*#__PURE__*/ (() => {
	try {
		return globalThis.process?.getBuiltinModule?.("node:async_hooks")?.AsyncResource;
	} catch {
		return;
	}
})(), yi = () => vi === void 0 ? void 0 : new vi("effect/Fiber"), bi = () => globalThis[Ue], xi = class {
	constructor(e, t = !0) {
		this.setContext(e), this.id = ++_i.id, this.currentOpCount = 0, this.interruptible = t, this._stack = [], this._observers = void 0, this._exit = void 0, this._children = void 0, this._interruptedCause = void 0, this._yielded = void 0, this._running = !1, this._deferredInterrupt = !1, this._parent = void 0, this._asyncContext = void 0, this.cache.runtimeMetrics?.recordFiberStart(this.context);
	}
	get [hi]() {
		return gi;
	}
	get currentDispatcher() {
		return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
	}
	getRef(e) {
		return P(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), c) : (this._observers === void 0 ? this._observers = [e] : this._observers.push(e), () => this.removeObserver(e));
	}
	removeObserver(e) {
		if (this._exit || this._observers === void 0) return;
		let t = this._observers.indexOf(e);
		t >= 0 && this._observers.splice(t, 1);
	}
	interruptUnsafe(e, t) {
		if (this._exit) return;
		let n = fi(e);
		this.cache.stackFrame && (n = Ot(n, or(Ft, this.cache.stackFrame))), t && (n = Ot(n, t)), this._interruptedCause = this._interruptedCause ? wt(this._interruptedCause, n) : n, this.interruptible && (this._running ? this._deferredInterrupt = !0 : this.evaluate(I(this._interruptedCause)));
	}
	pollUnsafe() {
		return this._exit;
	}
	evaluate(e) {
		if (this._exit) return;
		if (this._asyncContext !== void 0) {
			let t = this._asyncContext;
			return this._asyncContext = void 0, t.runInAsyncScope(this.evaluate, this, e);
		}
		if (this._yielded !== void 0) {
			let e = this._yielded;
			this._yielded = void 0, e();
		}
		let t = this.runLoop(e);
		if (t === lt) {
			this._asyncContext = yi();
			return;
		}
		let n = Ti.interruptChildren && Ti.interruptChildren(this);
		if (n !== void 0) return this.evaluate(L(n, () => t));
		if (this._exit = t, this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit), this._parent &&= (this._parent._children?.delete(this), void 0), this._observers !== void 0) {
			let e = this._observers;
			this._observers = void 0;
			for (let n = 0; n < e.length; n++) e[n](t);
		}
		this._stack.length = 0, this._children = void 0, this.context = ir();
	}
	runLoop(e) {
		let t = globalThis[Ue];
		globalThis[Ue] = this;
		let n = this._running;
		this._running = !0;
		let r = !1, i = e;
		this.currentOpCount = 0;
		try {
			for (;;) try {
				this._deferredInterrupt && (this._deferredInterrupt = !1, i = I(this._interruptedCause)), this.currentOpCount++;
				let e = this.cache;
				if (!r && !e.preventYield && e.scheduler.shouldYield(this)) {
					r = !0;
					let e = i;
					i = L(Ni, () => e);
				}
				if (i = e.tracerContext ? e.tracerContext(i, this) : i[D](this), i === lt) {
					let e = this._yielded;
					if ("~effect/Exit" in e) return this._deferredInterrupt = !1, this._yielded = void 0, e;
					if (this._deferredInterrupt) {
						this._yielded = void 0, e();
						continue;
					}
					return lt;
				}
			} catch (e) {
				if (!h(i, "~effect/Effect/evaluate")) return Rt(`Fiber.runLoop: Not a valid effect: ${String(i)}`);
				i = Rt(e);
			}
		} finally {
			this._running = n, globalThis[Ue] = t;
		}
	}
	getCont(e) {
		if (this._deferredInterrupt) return this._deferredInterrupt = !1, Ci;
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[ct];
			if (n !== void 0) {
				let r = n.call(t, this);
				if (r) return r[e] = r, r;
			}
			if (t[e]) return t;
		}
	}
	succeedWith(e) {
		if (!(++this.currentOpCount & wi - 1)) return j(e);
		let t = this.getCont(O);
		return t ? t[O](e, this) : this.yieldWith(j(e));
	}
	yieldWith(e) {
		return this._yielded = e, lt;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
	pipe() {
		return e(this, arguments);
	}
	setContext(e) {
		let t = this.context;
		if (this.context = e, t !== void 0 && tr(t, e)) return;
		let n = e.cacheRoot, r = n._fiberCache ??= Si(e);
		this.cache?.scheduler !== r.scheduler && (this._dispatcher = void 0), this.cache = r;
	}
	get currentSpanLocal() {
		let e = this.cache.span;
		return e?._tag === "Span" ? e : void 0;
	}
}, Si = (e) => {
	let t = lr(e, ai);
	return {
		scheduler: P(e, Jr),
		tracer: t,
		tracerContext: t ? t.context : void 0,
		tracerEnabled: P(e, ci),
		span: lr(e, ii),
		logLevel: P(e, li),
		minimumLogLevel: P(e, ui),
		stackFrame: P(e, si),
		runtimeMetrics: lr(e, oi),
		maxOpsBeforeYield: P(e, ti),
		preventYield: P(e, ni)
	};
}, Ci = {
	[O](e, t) {
		return I(t._interruptedCause);
	},
	[k](e, t) {
		return I(t._interruptedCause);
	}
}, wi = 32, Ti = { interruptChildren: void 0 }, Ei = (e) => {
	if (!e.cache.stackFrame) return;
	let t = /* @__PURE__ */ new Map();
	return t.set(It.key, e.cache.stackFrame), $n(t);
}, Di = (e) => zi((t) => {
	let n = e[Symbol.iterator](), r = [], i;
	function a() {
		let e = n.next();
		for (; !e.done;) if (e.value._exit) r.push(e.value._exit), e = n.next();
		else {
			i = e.value.addObserver((e) => {
				r.push(e), a();
			});
			return;
		}
		t(ki(r));
	}
	return a(), ji(() => i?.());
}), Oi = (e) => zt((t) => {
	let n = Ei(t), r = yn();
	for (let i of e) i.interruptUnsafe(t.id, n), r.push(i);
	return Zi(Di(r));
}), ki = j, I = M, Ai = Lt, ji = /*#__PURE__*/ Nt({
	op: "Sync",
	[D](e) {
		let t = this[E](), n = e.getCont(O);
		return n ? n[O](t, e) : e.yieldWith(j(t));
	}
}), Mi = /*#__PURE__*/ Nt({
	op: "Suspend",
	[D](e) {
		return this[E]();
	}
}), Ni = /*#__PURE__*/ (/* @__PURE__ */ Nt({
	op: "Yield",
	[D](e) {
		let t = !1;
		return e.currentDispatcher.scheduleTask(() => {
			t || e.evaluate(na);
		}, this["~effect/Effect/args"] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), Pi = (e) => Mi(() => I(e())), Fi = (e) => Rt(e), Ii = /*#__PURE__*/ ki(void 0), Li = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ A({
		op: "Async",
		[D](e) {
			let t = !1, n = !1, r = this.withSignal ? new AbortController() : void 0, i = this.register.call(e.cache.scheduler, (r) => {
				t || (t = !0, n ? e.evaluate(r) : n = r);
			}, r?.signal);
			return n === !1 ? (n = !0, e._yielded = () => {
				t = !0;
			}, r === void 0 && i === void 0 || e._stack.push(Ri(() => (t = !0, r?.abort(), i ?? na))), lt) : n;
		}
	}), t = function(e, t) {
		this.register = e, this.withSignal = t;
	};
	return t.prototype = e, function(e, n) {
		return new t(e, n);
	};
}(), Ri = /*#__PURE__*/ Nt({
	op: "AsyncFinalizer",
	[ct](e) {
		e.interruptible && (e.interruptible = !1, e._stack.push(da));
	},
	[k](e, t) {
		return pi(e) ? L(la(M(e), this[E]()), () => I(e)) : I(e);
	}
}), zi = (e) => Li(e, e.length >= 2), Bi = (e, t) => Object.defineProperty(t, "length", {
	value: e,
	configurable: !0
}), Vi = (e, ...t) => Bi(e.length, t.length === 0 ? function() {
	return Hi(() => e.apply(this, arguments));
} : function() {
	let n = Hi(() => e.apply(this, arguments));
	for (let e of t) n = e(n, ...arguments);
	return n;
}), Hi = (e) => {
	try {
		let t = e(), n;
		for (;;) {
			let r = t.next(n);
			if (r.done) return ki(r.value);
			let i = r.value;
			if (i && i._tag === "Success") n = i.value;
			else {
				if (i && i._tag === "Failure") return r.value;
				{
					let n = !0;
					return Mi(() => n ? (n = !1, L(r.value, (e) => Ui(t, e))) : Mi(() => Ui(e())));
				}
			}
		}
	} catch (e) {
		return Fi(e);
	}
}, Ui = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ A({
		op: "Iterator",
		[O](e, t) {
			let n = this.iterator;
			for (;;) {
				let r = n.next(e);
				if (r.done) return ki(r.value);
				if (!R(r.value)) return t._stack.push(this), r.value;
				if (r.value._tag === "Failure") return r.value;
				e = r.value.value;
			}
		},
		[D](e) {
			return this[O](this.initial, e);
		}
	}), t = function(e, t) {
		this.iterator = e, this.initial = t;
	};
	return t.prototype = e, function(e, n) {
		return new t(e, n);
	};
}(), Wi = function(e) {
	return e._stack.push(this), this[E];
}, Gi = /*#__PURE__*/ A({
	op: "OnSuccess",
	[D]: Wi
}), Ki = function(e, t, n) {
	this[E] = e, this[O] = t, this.payload = n;
};
Ki.prototype = Gi;
var qi = function() {
	return this.payload;
}, Ji = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ et();
	if (e === 0) return !1;
	let t = "~effect/Effect/stackProbe", n = { [t]: function() {
		return /* @__PURE__ */ Error();
	} };
	tt(1);
	let r = /*#__PURE__*/ n[t]();
	return tt(e), r.stack?.includes("[as " + t + "]") === !0;
})(), Yi = function(e, t) {
	let n = this.payload;
	return t.succeedWith(Ji ? n(e) : rt(() => n(e)));
}, Xi = function(e) {
	let t = this.payload;
	return t(e);
}, Zi = (e) => new Ki(e, qi, na), L = /*#__PURE__*/ r(2, (e, t) => new Ki(e, Xi, t)), R = (e) => e[at] !== void 0, Qi = /*#__PURE__*/ r(2, (e, t) => R(e) ? e._tag === "Success" ? t(e.value) : e : L(e, t)), $i = /*#__PURE__*/ r(2, (e, t) => new Ki(e, Yi, t)), ea = /*#__PURE__*/ r(2, (e, t) => R(e) ? ra(e, t) : $i(e, t)), ta = (e) => e._tag === "Success", na = /*#__PURE__*/ j(void 0), ra = /*#__PURE__*/ r(2, (e, t) => e._tag === "Success" ? j(t(e.value)) : e), ia = /*#__PURE__*/ r(2, (e, t) => new oa(e, t.length === 1 ? t : (e) => t(e))), aa = /*#__PURE__*/ A({
	op: "OnFailure",
	[D]: Wi
}), oa = function(e, t) {
	this[E] = e, this[k] = t;
};
oa.prototype = aa;
var sa = (e) => R(e) ? j(e) : ca(e), ca = /*#__PURE__*/ Nt({
	op: "Exit",
	[D](e) {
		return e._stack.push(this), this[E];
	},
	[O](e, t, n) {
		return t.succeedWith(n ?? j(e));
	},
	[k](e, t, n) {
		return t.succeedWith(n ?? M(e));
	}
}), la = (e, t) => ta(e) ? t : ia(t, (t) => I(Ct(e.cause, t))), ua = (e) => zt((t) => (t.interruptible && (t.interruptible = !1, t._stack.push(da)), e)), da = /*#__PURE__*/ (/* @__PURE__ */ Nt({
	op: "SetInterruptible",
	[ct](e) {
		if (e.interruptible = this[E], e._interruptedCause && e.interruptible) return () => I(e._interruptedCause);
	}
}))(!0), fa = (e) => e === "unbounded" ? Infinity : Math.max(1, e ?? 1), pa = () => (e) => {
	let t = e.onItem, n = e.step, r = (e, t, r, a, o) => L(sa(o), (o) => n(e, t[r], o, r) ?? i(e, t, r + 1, a) ?? Ii), i = (e, i, a = 0, o = i.length) => {
		for (; a < o; a++) {
			let s = i[a], c = t(e, s, a);
			if (!R(c)) return r(e, i, a, o, c);
			let l = n(e, s, c, a);
			if (l) return l._tag === "Failure" ? l : void 0;
		}
	};
	return i;
}, ma = (e) => {
	let t = e.onItem, n = e.step;
	return (e, r, i) => {
		let a = 0, o = i.end ?? r.length, s = i.concurrency, c = !1, l, u, d, f, p, m = (e) => {
			let t = Rt(e);
			return f = t, c = !0, u && u.size > 0 ? L(ua(Oi(Array.from(u))), () => f ?? t) : t;
		}, ee = () => {
			let i = !1;
			for (; !f && a < o; a++) {
				let o = r[a], te = p ?? t(e, o, a);
				if (R(te)) {
					if (f = n(e, o, te, a), f) break;
				} else if (l) {
					p = void 0;
					let t = ga(l, te, !0, !0, "inherit");
					if (t._exit) {
						if (f = n(e, o, t._exit, a), f) break;
						continue;
					}
					u.add(t);
					let r = a;
					if (t.addObserver((a) => {
						u.delete(t);
						try {
							if (f) {
								if (a._tag === "Failure") {
									let e = a.cause.reasons.filter((e) => e._tag !== "Interrupt");
									if (e.length > 0) {
										let t = xt(e);
										f = M(f._tag === "Failure" ? Ct(f.cause, t) : t);
									}
								}
							} else {
								let t = n(e, o, a, r);
								t && (f = t, ee());
							}
							if (i) {
								let e = ee();
								e && d(e);
							} else c && u.size === 0 && d(f ?? Ii);
						} catch (e) {
							d(m(e));
						}
					}), u.size < s) continue;
					i = !0, a++;
					return;
				} else return zi((e) => {
					l = bi(), u = /* @__PURE__ */ new Set(), p = te, d = e;
					let t;
					try {
						t = ee();
					} catch (t) {
						return e(m(t));
					}
					return t ? e(t) : Mi(() => (f ??= na, L(u ? Oi(u) : Ii, () => f?._tag === "Failure" ? f : Ii)));
				});
			}
			if (c = !0, f) {
				if (u && u.size > 0) {
					let e = Ei(l);
					u.forEach((t) => t.interruptUnsafe(l.id, e));
					return;
				}
				if (d || f._tag === "Failure") return f;
			} else if (d) {
				if (u) u.size === 0 && d(Ii);
				else return na;
			}
		};
		return ee();
	};
}, ha = () => (e) => ma(e), ga = (e, t, n = !1, r = !1, i = !1) => {
	let a = e, o = i === "inherit" ? a.interruptible : !i, s = new xi(a.context, o);
	return r || (a.children().add(s), s._parent = a), n ? s.evaluate(t) : (s._asyncContext = yi(), a.currentDispatcher.scheduleTask(() => s.evaluate(t), 0)), s;
}, _a = (e) => (t, n) => {
	let r = new xi(n?.scheduler ? sr(e, Jr, n.scheduler) : e, n?.uninterruptible !== !0);
	if (r.evaluate(t), r._exit) return r;
	if (n?.signal) {
		if (n.signal.aborted) r.interruptUnsafe();
		else {
			let e = () => r.interruptUnsafe();
			n.signal.addEventListener("abort", e, { once: !0 }), r.addObserver(() => n.signal.removeEventListener("abort", e));
		}
	}
	return n?.onFiberStart && n.onFiberStart(r), r;
}, va = /*#__PURE__*/ ((e) => {
	let t = _a(e);
	return (e) => {
		if (R(e)) return e;
		let n = new $r("sync"), r = t(e, { scheduler: n });
		return r._dispatcher?.flush(), r._exit ?? Rt(new ba(r));
	};
})(/*#__PURE__*/ ir()), ya = "~effect/Cause/AsyncFiberError", ba = class extends (/*#__PURE__*/ Ht("AsyncFiberError")) {
	[ya] = ya;
	constructor(e) {
		super({
			message: "An asynchronous Effect was executed with Effect.runSync",
			fiber: e
		});
	}
}, z = {
	bold: "1",
	red: "31",
	green: "32",
	yellow: "33",
	blue: "34",
	cyan: "36",
	white: "37",
	gray: "90",
	black: "30",
	bgBrightRed: "101"
};
z.gray, z.blue, z.green, z.yellow, z.red, z.bgBrightRed, z.black;
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Cause.js
var xa = kt, Sa = Dt, Ca = mi, wa = j, Ta = M, Ea = Lt, Da = na, Oa = ta, ka = "~effect/DateTime", Aa = "~effect/DateTime/TimeZone", ja = {
	[ka]: ka,
	pipe() {
		return e(this, arguments);
	},
	[w]() {
		return this.toString();
	},
	toJSON() {
		return Na(this).toJSON();
	}
};
({ ...ja }), { ...ja };
var Ma = {
	[Aa]: Aa,
	[w]() {
		return this.toString();
	}
};
({ ...Ma }), { ...Ma };
var Na = (e) => new Date(e.epochMilliseconds), Pa = ki, Fa = Mi, B = Ai, Ia = Pi, La = Fi, V = L, Ra = sa, za = ia, Ba = va, Va = ea, H = Qi, Ha = Vi, Ua = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", Wa = /*#__PURE__*/ (/* @__PURE__ */ new Uint8Array(123)).fill(255);
for (let e = 0; e < 64; e++) Wa[/*#__PURE__*/ Ua.charCodeAt(e)] = e;
Wa[61] = 0, { ...T }, { ...T }, { ...ut }, T.toString, T[w], { ...ut };
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/schema/annotations.js
function Ga(e) {
	return e.checks ? e.checks[e.checks.length - 1].annotations : e.annotations;
}
var Ka = "~structural", qa = "~sentinels", Ja = "~constructor", Ya = /*#__PURE__*/ l((e) => {
	let t = Ga(e)?.identifier;
	return typeof t == "string" ? t : e.getExpected(Ya);
}), U = /*#__PURE__*/ Symbol(), W = wa, G = /*#__PURE__*/ W(U), K = /*#__PURE__*/ W(U), Xa = (e) => e === U ? pn() : mn(e), Za = (e) => e._tag === "None" ? G : W(e.value), Qa = "~effect/SchemaIssue/Issue";
function $a(e) {
	return h(e, Qa) && e[Qa] === Qa;
}
function eo(e) {
	return Object.hasOwn(e, "input");
}
var q = class {
	[Qa] = Qa;
	constructor(e, t) {
		t?.reportInput === !0 && e !== U && (this.input = e);
	}
}, to = class extends q {
	_tag = "Filter";
	filter;
	issue;
	constructor(e, t, n, r) {
		super(n, r), this.filter = e, this.issue = t;
	}
}, no = class extends q {
	_tag = "Encoding";
	ast;
	issue;
	constructor(e, t, n, r) {
		super(n, r), this.ast = e, this.issue = t;
	}
}, ro = class extends q {
	_tag = "Pointer";
	path;
	issue;
	constructor(e, t) {
		super(), this.path = e, this.issue = t;
	}
}, io = class extends q {
	_tag = "MissingKey";
	annotations;
	constructor(e) {
		super(), this.annotations = e;
	}
}, ao = class extends q {
	_tag = "UnexpectedKey";
	ast;
	constructor(e, t, n) {
		super(t, n), this.ast = e;
	}
}, J = class extends q {
	_tag = "Composite";
	ast;
	issues;
	constructor(e, t, n, r) {
		super(n, r), this.ast = e, this.issues = t;
	}
}, oo = class extends q {
	_tag = "InvalidType";
	ast;
	constructor(e, t, n) {
		super(t, n), this.ast = e;
	}
}, so = class extends q {
	_tag = "InvalidValue";
	annotations;
	constructor(e, t, n) {
		super(t, n), this.annotations = e;
	}
}, co = class extends q {
	_tag = "AnyOf";
	ast;
	issues;
	constructor(e, t, n, r) {
		super(n, r), this.ast = e, this.issues = t;
	}
}, lo = class extends q {
	_tag = "OneOf";
	ast;
	successes;
	constructor(e, t, n, r) {
		super(n, r), this.ast = e, this.successes = t;
	}
};
function uo(e, t, n) {
	if ($a(e)) return e;
	if (typeof e == "string") return new so({ message: e }, t, n);
	let r = typeof e.issue == "string" ? new so({ message: e.issue }, t, n) : e.issue;
	return new ro(e.path, r);
}
function fo(e, t, n) {
	if (e !== void 0) return typeof e == "boolean" ? e ? void 0 : new so(void 0, t, n) : uo(e, t, n);
}
function po(e, t, n, r) {
	return Array.isArray(t) ? vn(t) ? t.length === 1 ? uo(t[0], n, r) : new J(e, bn(t, (e) => uo(e, n, r)), n, r) : void 0 : fo(t, n, r);
}
var mo = (e) => {
	let t = Co(e);
	if (t !== void 0) return t;
	switch (e._tag) {
		case "InvalidType": return vo(Ya(e.ast), e);
		case "InvalidValue": {
			let t = _o(e);
			if (t !== void 0) return vo(t, e);
			let n = go(e);
			return n === void 0 ? "Expected a valid value" : `Invalid data ${n}`;
		}
		case "MissingKey": return "Missing key";
		case "UnexpectedKey": {
			let t = go(e);
			return t === void 0 ? "Expected no excess property" : `Unexpected key with value ${t}`;
		}
		case "Forbidden": return "Forbidden operation";
		case "OneOf": {
			let t = go(e);
			return t === void 0 ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${t}`;
		}
	}
}, ho = (e) => Co(e.issue) ?? Co(e);
function go(e) {
	return eo(e) ? C(e.input) : void 0;
}
function _o(e) {
	let t = e.annotations?.expected;
	return typeof t == "string" ? t : void 0;
}
function vo(e, t) {
	let n = go(t);
	return n === void 0 ? `Expected ${e}` : `Expected ${e}, got ${n}`;
}
function yo(e) {
	let t = e.annotations?.expected;
	if (typeof t == "string") return t;
	switch (e._tag) {
		case "Filter": return "<filter>";
		case "FilterGroup": return e.checks.map((e) => yo(e)).join(" & ");
	}
}
function bo() {
	return (e) => So(e, "");
}
var xo = /*#__PURE__*/ bo();
function So(e, t) {
	let n;
	switch (e._tag) {
		case "Filter": {
			let r = ho(e);
			if (r !== void 0) n = r;
			else {
				if (e.issue._tag !== "InvalidValue") return So(e.issue, t);
				let r = _o(e.issue);
				n = r === void 0 ? vo(yo(e.filter), e) : vo(r, e.issue);
			}
			break;
		}
		case "Encoding": return So(e.issue, t);
		case "Pointer": return So(e.issue, t + Je(e.path));
		case "Composite":
		case "AnyOf":
			if (e._tag === "Composite" || e.issues.length > 0) return e.issues.map((e) => So(e, t)).join("\n");
			n = Co(e) ?? vo(Ya(e.ast), e);
			break;
		default: n = mo(e);
	}
	return t ? `${n}\n  at ${t}` : n;
}
function Co(e) {
	if (e._tag === "Pointer") return;
	if (e._tag === "Encoding") return Co(e.issue);
	let t = (e._tag === "Filter" ? e.filter.annotations : "annotations" in e ? e.annotations : e.ast.annotations)?.[e._tag === "MissingKey" ? "messageMissingKey" : e._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
	if (typeof t == "string") return t;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/schema/cause.js
function wo(e) {
	let t;
	for (let n of e.reasons) {
		if (!xa(n) || !$a(n.error)) return;
		t ??= n.error;
	}
	return t;
}
function To(e, t) {
	let n = wo(e);
	if (n === void 0) throw Error(t, { cause: e });
	return n;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/SchemaGetter.js
var Eo = (e) => Object.assign(Object.create(t), e), Do = /*#__PURE__*/ Eo({ _tag: "Passthrough" });
function Oo() {
	return Do;
}
function ko(e) {
	return Eo({
		_tag: "Transform",
		transform: e
	});
}
function Ao() {
	return ko(globalThis.String);
}
function jo() {
	return ko(globalThis.Number);
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/SchemaTransformation.js
var Mo = class extends n {
	_tag = "Middleware";
	decode;
	encode;
	constructor(e, t) {
		super(), this.decode = e, this.encode = t;
	}
	flip() {
		return new Mo(this.encode, this.decode);
	}
}, No = "~effect/SchemaTransformation/Transformation", Po = class extends n {
	[No] = No;
	_tag = "Transformation";
	decode;
	encode;
	constructor(e, t) {
		super(), this.decode = e, this.encode = t;
	}
	flip() {
		return new Po(this.encode, this.decode);
	}
};
function Fo(e) {
	return h(e, No) && e[No] === No;
}
var Io = (e) => Fo(e) ? e : new Po(e.decode, e.encode), Lo = /*#__PURE__*/ new Po(/*#__PURE__*/ Oo(), /*#__PURE__*/ Oo());
function Ro() {
	return Lo;
}
var zo = /*#__PURE__*/ new Po(/*#__PURE__*/ jo(), /*#__PURE__*/ Ao());
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/SchemaAST.js
function Bo(e) {
	return (t) => t._tag === e;
}
var Vo = /*#__PURE__*/ Bo("Declaration"), Ho = /*#__PURE__*/ Bo("Never"), Uo = /*#__PURE__*/ Bo("Literal"), Wo = /*#__PURE__*/ Bo("UniqueSymbol"), Go = /*#__PURE__*/ Bo("Arrays"), Ko = /*#__PURE__*/ Bo("Objects"), qo = /*#__PURE__*/ Bo("Suspend"), Y = class {
	to;
	transformation;
	constructor(e, t) {
		this.to = e, this.transformation = t;
	}
}, Jo = {}, Yo = class {
	isOptional;
	isMutable;
	constructorDefault;
	annotations;
	constructor(e, t, n = void 0, r = void 0) {
		this.isOptional = e, this.isMutable = t, this.constructorDefault = n, this.annotations = r;
	}
}, Xo = "~effect/Schema", X = class {
	[Xo] = Xo;
	annotations;
	checks;
	encoding;
	context;
	constructor(e = void 0, t = void 0, n = void 0, r = void 0) {
		this.annotations = e, this.checks = t, this.encoding = n, this.context = r;
	}
	toString() {
		return `<${this._tag}>`;
	}
}, Zo = class extends X {
	_tag = "Declaration";
	typeParameters;
	run;
	encodingChecks;
	encodingRun;
	constructor(e, t, n, r, i, a, o, s) {
		super(n, r, i, a), this.typeParameters = e, this.run = t, this.encodingChecks = o, this.encodingRun = s;
	}
	getParser() {
		let e;
		return (t, n) => t === U ? G : (e ??= this.run(this.typeParameters))(t, this, n);
	}
	_rebuild(e, t, n, r, i) {
		let a = dc(this.typeParameters, e);
		return a === this.typeParameters && t === this.checks && n === this.encodingChecks && r === this.run && i === this.encodingRun ? this : new Zo(a, r, this.annotations, t, void 0, this.context, n, i);
	}
	recur(e) {
		return this._rebuild(e, this.checks, this.encodingChecks, this.run, this.encodingRun);
	}
	flip(e) {
		return this._rebuild(e, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
	}
	getExpected() {
		let e = this.annotations?.expected;
		return typeof e == "string" ? e : "<Declaration>";
	}
}, Qo = /*#__PURE__*/ new class extends X {
	_tag = "Null";
	getParser() {
		return Tc(this, null);
	}
	getExpected() {
		return "null";
	}
}(), $o = /*#__PURE__*/ new class extends X {
	_tag = "Unknown";
	getParser() {
		return Ec(this, oe);
	}
	getExpected() {
		return "unknown";
	}
}(), es = class extends X {
	_tag = "Literal";
	literal;
	constructor(e, t, n, r, i) {
		if (super(t, n, r, i), typeof e == "number" && !globalThis.Number.isFinite(e)) throw Error(`A numeric literal must be finite, got ${C(e)}`);
		this.literal = e;
	}
	getParser() {
		return Tc(this, this.literal);
	}
	matchPart(e, t) {
		return e === globalThis.String(this.literal) ? this.literal : void 0;
	}
	toCodecJson() {
		return typeof this.literal == "bigint" ? ts(this) : this;
	}
	toCodecStringTree() {
		return typeof this.literal == "string" ? this : ts(this);
	}
	getExpected() {
		return typeof this.literal == "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
	}
};
function ts(e) {
	let t = globalThis.String(e.literal);
	return Z(e, [new Y(new es(t), new Po(ko(() => e.literal), ko(() => t)))]);
}
var ns = /*#__PURE__*/ new class extends X {
	_tag = "String";
	getParser() {
		return Ec(this, te);
	}
	matchPart(e, t) {
		let n = this.checks;
		return n && !t.disableChecks && Pc(n, e, void 0, this, t) ? void 0 : e;
	}
	getExpected() {
		return "string";
	}
}(), rs = class extends X {
	_tag = "Number";
	getParser() {
		return Ec(this, ne);
	}
	matchKey(e, t) {
		return this._match(kc, e, t);
	}
	matchPart(e, t) {
		return this._match(Oc, e, t);
	}
	_match(e, t, n) {
		if (!e.test(t)) return;
		let r = globalThis.Number(t);
		return n.disableChecks || !this.checks ? r : Pc(this.checks, r, void 0, this, n) ? void 0 : r;
	}
	toCodecJson() {
		return this.checks && (is(this.checks, "effect/schema/isFinite") || is(this.checks, "effect/schema/isInt")) ? this : Z(this, [Xs]);
	}
	toCodecStringTree() {
		return this.toCodecJson() === this ? Z(this, [Mc]) : Z(this, [Nc]);
	}
	getExpected() {
		return "number";
	}
};
function is(e, t) {
	return e.some((e) => e.annotations?.representation?.id === t || e._tag === "FilterGroup" && is(e.checks, t));
}
var as = /*#__PURE__*/ new rs(), os = /*#__PURE__*/ new class extends X {
	_tag = "Boolean";
	getParser() {
		return Ec(this, re);
	}
	getExpected() {
		return "boolean";
	}
}(), ss = class extends X {
	_tag = "Arrays";
	isMutable;
	elements;
	rest;
	encodingChecks;
	constructor(e, t, n, r, i, a, o, s) {
		super(r, i, a, o), this.isMutable = e, this.elements = t, this.rest = n, this.encodingChecks = s;
		let c = !1;
		for (let e = 0; e < t.length; e++) if (gc(t[e])) c = !0;
		else if (c) throw Error("A required element cannot follow an optional element. ts(1257)");
		if (c && n.length > 1) throw Error("A required element cannot follow an optional element. ts(1257)");
		for (let e = 1; e < n.length; e++) if (gc(n[e])) throw Error("An optional element cannot follow a rest element. ts(1266)");
	}
	getParser(e, t = e) {
		let n = this, r, i, a = n.elements.length, o = Math.max(0, n.rest.length - 1);
		function s(e, t) {
			return t < a ? r[t] : t >= e ? i[t - e + 1] : i[0];
		}
		let c = (e) => {
			let { input: t, len: r, options: i } = e;
			if (n.rest.length === 0 && r > a) for (let o = a; o < r; o++) {
				let r = new ao(n, t[o], i), a = new ro([o], r);
				if (i.errors === "all") e.issues ? e.issues.push(a) : e.issues = [a];
				else return B(new J(n, [a], t, i));
			}
			return e.issues ? B(new J(n, e.issues, t, i)) : W(e.output);
		}, l = (e, t) => {
			let r = e.length, i = {
				ast: n,
				getParser: s,
				input: e,
				len: r,
				tailThreshold: Math.max(a, r - o),
				output: new globalThis.Array(r),
				issues: void 0,
				options: t
			}, u = n.rest.length === 0 ? a : Math.max(r, a + o), d = t.concurrency === void 0 ? 1 : fa(t.concurrency), f = d === 1 ? us(i, e, 0, u) : ds(i, e, {
				concurrency: d,
				end: u
			});
			if (!f) return c(i);
			if (R(f)) return H(f, () => c(i));
			let p = !0;
			return Fa(() => p ? (p = !1, V(f, () => c(i))) : l(e, t));
		};
		return (e, a) => {
			if (e === U) return G;
			try {
				return Array.isArray(e) ? (r || (r = n.elements.map((e) => ({
					ast: e,
					parser: t(e)
				})), i = n.rest.map((e) => ({
					ast: e,
					parser: t(e)
				}))), l(e, a)) : B(new oo(n, e, a));
			} catch (e) {
				return La(e);
			}
		};
	}
	_rebuild(e, t, n) {
		let r = dc(this.elements, e), i = dc(this.rest, e);
		return r === this.elements && i === this.rest && t === this.checks && n === this.encodingChecks ? this : new ss(this.isMutable, r, i, this.annotations, t, void 0, this.context, n);
	}
	recur(e) {
		return this._rebuild(e, this.checks, this.encodingChecks);
	}
	flip(e) {
		return this._rebuild(e, this.encodingChecks, this.checks);
	}
	getExpected() {
		return "array";
	}
};
function cs(e, t, n, r) {
	if (n._tag === "Failure") return fs(e, e.ast, r, n);
	let i = n === K ? t : n[E];
	if (i !== U) e.output[r] = i;
	else {
		let t = e.getParser(e.tailThreshold, r);
		if (gc(t.ast)) return;
		let n = new ro([r], new io(t.ast.context?.annotations));
		if (e.options.errors === "all") e.issues ? e.issues.push(n) : e.issues = [n];
		else return Ea(new J(e.ast, [n], e.input, e.options));
	}
}
var ls = {
	onItem(e, t, n) {
		let r = n < e.len ? t : U;
		return e.getParser(e.tailThreshold, n).parser(r, e.options);
	},
	step: cs
}, us = /*#__PURE__*/ pa()(ls), ds = /*#__PURE__*/ ha()(ls), fs = (e, t, n, r) => {
	if (r.cause.reasons.length === 0) return r;
	let i = wo(r.cause);
	if (i === void 0) return Ta(Ca(r.cause, (r) => new J(t, [new ro([n], r)], e.input, e.options)));
	let a = new ro([n], i);
	if (e.options.errors === "all") e.issues ? e.issues.push(a) : e.issues = [a];
	else return Ea(new J(t, [a], e.input, e.options));
}, ps = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?";
function ms(e, t, n = Jo) {
	let r, i;
	function a(t) {
		switch (t._tag) {
			case "String":
			case "TemplateLiteral": return (r ??= Object.keys(e)).filter((e) => t.matchPart(e, n) !== void 0);
			case "Number": return (r ??= Object.keys(e)).filter((e) => t.matchKey(e, n) !== void 0);
			case "Symbol": return (i ??= Object.getOwnPropertySymbols(e)).filter((r) => Object.prototype.propertyIsEnumerable.call(e, r) && t.matchKey(r, n) !== void 0);
			case "Union": return [...new Set(t.types.flatMap(a))];
			default: return [];
		}
	}
	return a(Dc(xc(t)));
}
var hs = class {
	name;
	type;
	constructor(e, t) {
		this.name = e, this.type = t;
	}
};
function gs(e) {
	switch (e._tag) {
		case "String":
		case "Number":
		case "Symbol":
		case "TemplateLiteral": return !0;
		case "Union": return e.types.every(gs);
		default: return !1;
	}
}
function _s(e) {
	let t = nc(e);
	switch (t._tag) {
		case "String":
		case "Number":
		case "Symbol":
		case "TemplateLiteral": return !0;
		case "Union": return t.types.every(_s);
		default: return !1;
	}
}
function vs(e) {
	return gs(e) && _s(e);
}
var ys = class {
	parameter;
	type;
	constructor(e, t) {
		if (!vs(e)) throw Error(`Invalid index signature parameter ${e._tag}`);
		if (this.parameter = e, this.type = t, gc(t) && !wc(t)) throw Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
	}
}, bs = class extends X {
	_tag = "Objects";
	propertySignatures;
	indexSignatures;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.propertySignatures = e, this.indexSignatures = t, this.encodingChecks = o;
	}
	getParser(e, t = e) {
		let n = this, r = n.propertySignatures.length, i = n.indexSignatures.length;
		if (!r && !i) return Ec(n, ae);
		let a, o, s = () => (a || (a = n.propertySignatures.map((e) => ({
			parser: t(e.type),
			name: e.name,
			type: e.type
		})), o = i ? n.indexSignatures.map((n) => ({
			is: n,
			parserKey: e(Dc(n.parameter)),
			parserValue: t(n.type)
		})) : void 0), a), c = () => {
			let e = new Set(n.propertySignatures.map((e) => typeof e.name == "number" ? globalThis.String(e.name) : e.name)), t = (t, i, a, o, s) => {
				if (s._tag === "Failure") return fs(t, n, i, s) ?? Da;
				let c = s === K ? o : s[E];
				if (a !== U && c !== U) {
					if (r && (e.has(i) || e.has(typeof a == "number" ? globalThis.String(a) : a))) return Da;
					Le(t.out, a, c);
				}
				return Da;
			}, c = (e, r, i, a) => {
				if (!a) {
					let t = i.parserKey(r, e.options);
					if (!R(t)) return V(Ra(t), (t) => c(e, r, i, t));
					a = t;
				}
				if (a._tag === "Failure") return fs(e, n, r, a) ?? Da;
				let o = a === K ? r : a[E], s = e.input[r], l = i.parserValue(s, e.options);
				return R(l) ? t(e, r, o, s, l) : V(Ra(l), (n) => t(e, r, o, s, n));
			}, l = (e, n, r) => {
				let i = e.input[n], a = r.parserValue(i, e.options);
				return R(a) ? t(e, n, n, i, a) : V(Ra(a), (r) => t(e, n, n, i, r));
			}, u = i ? ha()({
				onItem: (e, [t, n]) => n.is.parameter === ns ? l(e, t, n) : c(e, t, n),
				step: (e, t, n) => n._tag === "Failure" ? n : void 0
			}) : void 0;
			return Ha(function* (t, d) {
				if (t === U) return U;
				if (typeof t != "object" || !t || Array.isArray(t)) return yield* B(new oo(n, t, d));
				s();
				let f = t, p = {}, m = {
					ast: n,
					input: f,
					out: p,
					issues: void 0,
					options: d
				}, ee = d.errors === "all", te = d.onExcessProperty === "error", ne = d.concurrency === void 0 ? 1 : fa(d.concurrency), re = i && te ? n.indexSignatures.map((e) => ms(f, e.parameter, d)) : void 0;
				if (te) {
					let r = re ? new Set(e) : e;
					if (re) for (let e of re) for (let t of e) r.add(t);
					let i = Reflect.ownKeys(f);
					for (let e = 0; e < i.length; e++) {
						let a = i[e];
						if (!r.has(a) && Object.prototype.propertyIsEnumerable.call(f, a)) {
							let e = new ao(n, f[a], d), r = new ro([a], e);
							if (ee) {
								m.issues ? m.issues.push(r) : m.issues = [r];
								continue;
							}
							return yield* B(new J(n, [r], t, d));
						}
					}
				}
				if (r) {
					let e = ne === 1 ? Cs(m, a) : ws(m, a, { concurrency: ne });
					e && (yield* e);
				}
				if (i && ne === 1) for (let e = 0; e < i; e++) {
					let t = o[e], n = t.is.parameter === ns ? l : c, r = re?.[e] ?? (t.is.parameter === ns ? Object.keys(f) : ms(f, t.is.parameter, d));
					for (let e = 0; e < r.length; e++) {
						let i = n(m, r[e], t);
						if (!R(i)) yield* i;
						else if (i._tag === "Failure") return yield* i;
					}
				}
				else if (u) {
					let e = yn();
					for (let t = 0; t < i; t++) {
						let n = o[t], r = re?.[t] ?? (n.is.parameter === ns ? Object.keys(f) : ms(f, n.is.parameter, d));
						for (let t = 0; t < r.length; t++) e.push([r[t], n]);
					}
					let t = u(m, e, { concurrency: ne });
					t && (yield* t);
				}
				return m.issues ? yield* B(new J(n, m.issues, t, d)) : p;
			});
		};
		if (i) return c();
		let l, u = (e, t, n) => {
			let r = a[t];
			return V(Ra(n), (n) => {
				let i = xs(e, r, n);
				if (i) return i;
				let o = () => W(e.out), s = Cs(e, a.slice(t + 1));
				return s ? H(s, o) : o();
			});
		};
		return (e, t) => {
			if (e === U) return G;
			if (t.errors === "all" || t.onExcessProperty !== void 0 || t.concurrency !== void 0 && fa(t.concurrency) !== 1) return (l ??= c())(e, t);
			if (typeof e != "object" || !e || Array.isArray(e)) return B(new oo(n, e, t));
			let r = s(), i = e, a = {}, o = {
				ast: n,
				input: i,
				out: a,
				issues: void 0,
				options: t
			};
			try {
				for (let e = 0; e < r.length; e++) {
					let n = r[e], s = n.name, c = Fs(i, s), l = c ? i[s] : U, d = n.parser(l, t);
					if (!R(d)) return u(o, e, d);
					if (d === K) {
						c && Le(a, s, l);
						continue;
					}
					let f = xs(o, n, d);
					if (f) return f;
				}
			} catch (e) {
				return La(e);
			}
			return W(a);
		};
	}
	_rebuild(e, t, n, r) {
		let i = dc(this.propertySignatures, (t) => {
			let n = e(t.type);
			return n === t.type ? t : new hs(t.name, n);
		}), a = dc(this.indexSignatures, (n) => {
			let r = t(n.parameter), i = e(n.type);
			return r === n.parameter && i === n.type ? n : new ys(r, i);
		});
		return i === this.propertySignatures && a === this.indexSignatures && n === this.checks && r === this.encodingChecks ? this : new bs(i, a, this.annotations, n, void 0, this.context, r);
	}
	flip(e) {
		return this._rebuild(e, e, this.encodingChecks, this.checks);
	}
	recur(e, t = e) {
		return this._rebuild(e, t, this.checks, this.encodingChecks);
	}
	getExpected() {
		return this.propertySignatures.length === 0 && this.indexSignatures.length === 0 ? "object | array" : "object";
	}
};
function xs(e, t, n) {
	if (n._tag === "Failure") return fs(e, e.ast, t.name, n);
	if (n === K) return;
	let r = n[E];
	if (r !== U) Le(e.out, t.name, r);
	else if (delete e.out[t.name], !gc(t.type)) {
		let n = new ro([t.name], new io(t.type.context?.annotations));
		if (e.options.errors === "all") {
			e.issues ? e.issues.push(n) : e.issues = [n];
			return;
		}
		return Ea(new J(e.ast, [n], e.input, e.options));
	}
}
var Ss = {
	onItem(e, t) {
		if (!Fs(e.input, t.name)) return t.parser(U, e.options);
		let n = e.input[t.name];
		return Le(e.out, t.name, n), t.parser(n, e.options);
	},
	step: xs
}, Cs = /*#__PURE__*/ pa()(Ss), ws = /*#__PURE__*/ ha()(Ss);
function Ts(e, t) {
	return e ? t ? [...e, ...t] : e : t;
}
function Es(e, t, n) {
	return new bs(Reflect.ownKeys(e).map((t) => new hs(t, e[t].ast)), [], n, t);
}
function Ds(e) {
	return e.ast;
}
function Os(e, t, n) {
	return new Ls(e.map(Ds), t, void 0, n);
}
var ks = /*#__PURE__*/ u((e) => {
	for (;;) {
		if (qo(e)) return $o;
		let t = e.encoding;
		if (!t) return e.recur?.(ks, i) ?? e;
		if (t.some((e) => e.transformation._tag === "Middleware" && e.transformation.decode !== i)) return $o;
		e = t[t.length - 1].to;
	}
});
function As(e) {
	switch (e._tag) {
		case "Null": return ["null"];
		case "Undefined": return ["undefined"];
		case "String":
		case "TemplateLiteral": return ["string"];
		case "Number": return ["number"];
		case "Boolean": return ["boolean"];
		case "Symbol":
		case "UniqueSymbol": return ["symbol"];
		case "BigInt": return ["bigint"];
		case "Arrays": return ["array"];
		case "ObjectKeyword": return [
			"object",
			"array",
			"function"
		];
		case "Objects": return e.propertySignatures.length || e.indexSignatures.length ? ["object"] : [
			"string",
			"number",
			"boolean",
			"symbol",
			"bigint",
			"object",
			"array",
			"function"
		];
		case "Enum": return Array.from(new Set(e.enums.map(([, e]) => typeof e)));
		case "Literal": return [typeof e.literal];
		case "Union": return Array.from(new Set(e.types.flatMap(As)));
		default: return [
			"null",
			"undefined",
			"string",
			"number",
			"boolean",
			"symbol",
			"bigint",
			"object",
			"array",
			"function"
		];
	}
}
function js(e) {
	switch (e._tag) {
		default: return [];
		case "Declaration": {
			let t = e.annotations?.[qa];
			return Array.isArray(t) ? t : [];
		}
		case "Objects": return e.propertySignatures.flatMap((e) => {
			let t = e.type;
			if (!gc(t)) {
				if (Uo(t)) return [{
					key: e.name,
					literal: t.literal
				}];
				if (Wo(t)) return [{
					key: e.name,
					literal: t.symbol
				}];
			}
			return [];
		});
		case "Arrays": return e.elements.flatMap((e, t) => {
			if (!gc(e)) {
				if (Uo(e)) return [{
					key: t,
					literal: e.literal
				}];
				if (Wo(e)) return [{
					key: t,
					literal: e.symbol
				}];
			}
			return [];
		});
		case "Union": {
			if (e.types.length === 0) return [];
			let t = e.types.map((e) => js(ks(e)));
			return t[0].filter((e) => t.every((t) => t.some((t) => t.key === e.key && t.literal === e.literal)));
		}
		case "Suspend": return js(e.thunk());
	}
}
var Ms = /*#__PURE__*/ new WeakMap(), Ns = /*#__PURE__*/ Object.freeze([]), Ps = (e) => e === null ? "null" : Array.isArray(e) ? "array" : typeof e, Fs = (e, t) => t === "__proto__" ? Object.hasOwn(e, t) : t in e;
function Is(e) {
	let t = Ms.get(e);
	if (t) return t;
	let n, r = 0, i, a, o = !0, s = [];
	for (let t = 0; t < e.length; t++) {
		let c = e[t], l = ks(c);
		if (Ho(l)) continue;
		if (Uo(l) || Wo(l)) {
			a ??= /* @__PURE__ */ new Map();
			let e = Uo(l) ? l.literal : l.symbol;
			s[t] = e;
			let n = a.get(e);
			n || a.set(e, n = []), n.push(t);
		} else o = !1;
		let u = js(l);
		if (u.length) {
			n ??= /* @__PURE__ */ new Map(), r++;
			for (let { key: e, literal: r } of u) {
				let i = n.get(e);
				i || n.set(e, i = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Set()]), i[1].add(t);
				let a = i[0].get(r);
				a || i[0].set(r, a = /* @__PURE__ */ new Set()), a.add(t);
			}
		} else {
			i ??= {};
			let e = As(l);
			for (let n of e) (i[n] ??= []).push(t);
		}
	}
	let c = {}, l = (e) => c[e] ??= Object.freeze(i?.[e] ?? Ns);
	if (o && a) a.forEach(Object.freeze), t = (e) => a.get(e) ?? Ns;
	else if (n?.size === 1 && !i) {
		let [r, [i]] = n.entries().next().value, a = /* @__PURE__ */ new Map();
		for (let [e, t] of i) a.set(e, Object.freeze(Array.from(t)));
		let o = Object.freeze(e.map((e, t) => t));
		t = (e, t) => {
			if (se(e)) {
				let n = Fs(e, r) ? e[r] : void 0;
				if (n !== void 0) return a.get(n) ?? Ns;
				if (t) return o;
			}
			return Ns;
		};
	} else if (n) {
		let e;
		for (let t of n) (!e || t[1][0].size > e[1][0].size) && t[1][1].size === r && (e = t);
		t = (t, r) => {
			let a = Ps(t);
			if (!se(t)) return l(a);
			let o = new Set(i?.[a]), s;
			if (e) {
				let [n, [i]] = e, c = Fs(t, n), u = c ? t[n] : void 0;
				if (c && (!r || u !== void 0)) {
					let e = i.get(u);
					if (!e) return l(a);
					for (let t of e) o.add(t);
					s = n;
				}
			}
			if (s === void 0) for (let [e, [i, a]] of n) {
				let n = Fs(t, e), s = n ? t[e] : void 0;
				if (n && (!r || s !== void 0)) {
					let e = i.get(s);
					if (e) for (let t of e) o.add(t);
				} else if (r) for (let e of a) o.add(e);
			}
			for (let [e, [i, a]] of n) {
				if (e === s) continue;
				let n = Fs(t, e), c = n ? t[e] : void 0;
				if (n && (!r || c !== void 0)) {
					let e = i.get(c);
					for (let t of o) a.has(t) && !e?.has(t) && o.delete(t);
				}
			}
			return Array.from(o).sort((e, t) => e - t);
		};
	} else t = (e) => {
		let t = l(Ps(e));
		return a ? t.filter((t) => s[t] === void 0 || s[t] === e) : t;
	};
	return Ms.set(e, t), t;
}
var Ls = class extends X {
	_tag = "Union";
	types;
	options;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.types = e, this.options = t, this.encodingChecks = o;
	}
	getParser(e, t) {
		let n = this, r = t !== void 0, i = [], a = (t) => i[t] ??= e(n.types[t]), o;
		return (e, t) => {
			if (e === U) return G;
			let i = (o ??= Is(n.types))(e, r);
			if (i.length === 0) return B(new co(n, [], e, t));
			if (i.length === 1) {
				let r = a(i[0])(e, t);
				return r._tag === "Success" ? r : R(r) ? Rs(n, r.cause, e, t) : zs(n, r, e, t);
			}
			return Bs(n, a, i, e, t);
		};
	}
	_rebuild(e, t, n) {
		let r = dc(this.types, e);
		return r === this.types && t === this.checks && n === this.encodingChecks ? this : new Ls(r, this.options, this.annotations, t, void 0, this.context, n);
	}
	recur(e) {
		return this._rebuild(e, this.checks, this.encodingChecks);
	}
	flip(e) {
		return this._rebuild(e, this.encodingChecks, this.checks);
	}
	matchPart(e, t) {
		for (let n of this.types) {
			let r = n.matchPart(e, t);
			if (r !== void 0) return r;
		}
	}
	getExpected(e) {
		let t = this.annotations?.expected;
		if (typeof t == "string") return t;
		if (this.types.length === 0) return "never";
		let n = this.types.map((t) => {
			let n = xc(t);
			switch (n._tag) {
				case "Arrays": {
					let t = n.elements.filter(Uo);
					if (t.length > 0) return `${Ws(n.isMutable)}[ ${t.map((t) => e(t) + Gs(t.context?.isOptional)).join(", ")}, ... ]`;
					break;
				}
				case "Objects": {
					let t = n.propertySignatures.filter((e) => Uo(e.type));
					if (t.length > 0) return `{ ${t.map((t) => `${Ws(t.type.context?.isMutable)}${qe(t.name)}${Gs(t.type.context?.isOptional)}: ${e(t.type)}`).join(", ")}, ... }`;
					break;
				}
			}
			return e(n);
		});
		return Array.from(new Set(n)).join(" | ");
	}
};
function Rs(e, t, n, r) {
	let i = wo(t);
	return i ? Ea(new co(e, [i], n, r)) : Ta(t);
}
function zs(e, t, n, r) {
	return za(t, (t) => Rs(e, t, n, r));
}
function Bs(e, t, n, r, i) {
	let a = {
		ast: e,
		parser: t,
		input: r,
		out: void 0,
		successes: e.options?.mode === "oneOf" ? [] : void 0,
		issues: void 0,
		options: i
	}, o = Hs(a, n);
	if (!o) return a.out ? a.out : B(new co(e, a.issues ?? [], r, i));
	if (R(o)) return Vs(o, a);
	let s = !0;
	return Fa(() => s ? (s = !1, Vs(o, a)) : Bs(e, t, n, r, i));
}
function Vs(e, t) {
	return H(e, (e) => t.out === K ? Pa(t.input) : t.out ? t.out : B(new co(t.ast, t.issues ?? [], t.input, t.options)));
}
var Hs = /*#__PURE__*/ pa()({
	onItem(e, t) {
		return e.parser(t)(e.input, e.options);
	},
	step(e, t, n) {
		if (n._tag === "Failure") {
			let t = wo(n.cause);
			if (t === void 0) return n;
			e.issues ? e.issues.push(t) : e.issues = [t];
		} else {
			if (e.out && e.successes) return e.successes.push(e.ast.types[t]), Ea(new lo(e.ast, e.successes, e.input, e.options));
			if (e.out = n, e.successes) e.successes.push(e.ast.types[t]);
			else return Da;
		}
	}
}), Us = /*#__PURE__*/ new Ls([
	/*#__PURE__*/ new es("Infinity"),
	/*#__PURE__*/ new es("-Infinity"),
	/*#__PURE__*/ new es("NaN")
]);
function Ws(e) {
	return e ? "" : "readonly ";
}
function Gs(e) {
	return e ? "?" : "";
}
var Ks = class extends n {
	_tag = "Filter";
	run;
	annotations;
	aborted;
	constructor(e, t = void 0, n = !1) {
		super(), this.run = e, this.annotations = t, this.aborted = n;
	}
	annotate(e) {
		return new Ks(this.run, {
			...this.annotations,
			...e
		}, this.aborted);
	}
	abort() {
		return new Ks(this.run, this.annotations, !0);
	}
	and(e, t) {
		return new qs([this, e], t);
	}
}, qs = class extends n {
	_tag = "FilterGroup";
	checks;
	annotations;
	constructor(e, t = void 0) {
		super(), this.checks = e, this.annotations = t;
	}
	annotate(e) {
		return new qs(this.checks, {
			...this.annotations,
			...e
		});
	}
	and(e, t) {
		return new qs([this, e], t);
	}
};
function Js(e, t, n = !1) {
	return new Ks((t, n, r) => po(n, e(t, n, r), t, r), t, n);
}
function Ys(e) {
	return Js((e) => globalThis.Number.isFinite(e), {
		expected: "a finite number",
		representation: {
			id: "effect/schema/isFinite",
			payload: null
		},
		toJsonSchema: () => ({ type: "number" }),
		toCode: () => ({ runtime: "Schema.isFinite()" }),
		arbitraryConstraint: { number: "finite" },
		...e
	});
}
var Xs = /*#__PURE__*/ new Y(/*#__PURE__*/ new Ls([/* @__PURE__ */ ac(as, [/*#__PURE__*/ Ys()]), Us]), /*#__PURE__*/ new Po(/*#__PURE__*/ jo(), /*#__PURE__*/ ko((e) => globalThis.Number.isFinite(e) ? e : globalThis.String(e))));
function Zs(e, t) {
	let n = new globalThis.RegExp(e), r = {
		source: n.source,
		flags: n.flags
	};
	return Js((e) => (n.lastIndex = 0, n.test(e)), {
		expected: `a string matching the RegExp ${r.source}`,
		representation: {
			id: "effect/schema/isPattern",
			payload: r
		},
		toJsonSchema: () => [{}, !0],
		arbitraryConstraint: { patterns: [r] },
		...t
	});
}
var Qs = /*#__PURE__*/ new WeakMap();
function $s(e, t) {
	let n = Object.assign(Object.create(Object.getPrototypeOf(e)), e, t);
	return Reflect.ownKeys(t).every((e) => e === "context" || e === "encoding") && Qs.set(n, ec(e)), n;
}
function ec(e) {
	let t = Qs.get(e);
	if (t !== void 0) return t;
	if (e.encoding === void 0) return e;
	let n = Object.assign(Object.create(Object.getPrototypeOf(e)), e, { encoding: void 0 });
	return Qs.set(e, n), n;
}
function Z(e, t) {
	return e.encoding === t ? e : $s(e, { encoding: t });
}
function tc(e, t) {
	if (e.context === t) return e;
	let n = ec(e);
	return n.context === t && n.encoding === e.encoding ? n : $s(e, { context: t });
}
function nc(e) {
	return e.encoding ? nc(e.encoding[e.encoding.length - 1].to) : e;
}
function rc(e, t) {
	if (e.checks) {
		let n = e.checks[e.checks.length - 1];
		return ic(e, gn(e.checks.slice(0, -1), n.annotate(t)));
	}
	return $s(e, { annotations: {
		...e.annotations,
		...t
	} });
}
function ic(e, t) {
	if (e._tag === "Suspend" && t) throw Error("Cannot add checks to Suspend");
	return e.checks === t ? e : $s(e, { checks: t });
}
function ac(e, t) {
	return ic(e, Ts(e.checks, t));
}
function oc(e, t) {
	let n = t(e.to);
	return n === e.to ? e : new Y(n, e.transformation);
}
function sc(e, t) {
	let n = e, r = n[n.length - 1], i = oc(r, t);
	return i === r ? e : gn(e.slice(0, e.length - 1), i);
}
function cc(e) {
	return (t) => t.encoding ? Z(t, sc(t.encoding, e)) : t;
}
function lc(e, t) {
	function n(r) {
		if (r.encoding) {
			let e = r.encoding[r.encoding.length - 1];
			return t?.stopAt?.(e) ? r : Z(r, sc(r.encoding, n));
		}
		return e(r);
	}
	return u(n);
}
function uc(e, t, n) {
	let r = new Y(e, t);
	return Z(n, n.encoding ? [...n.encoding, r] : [r]);
}
function dc(e, t) {
	let n;
	for (let r = 0; r < e.length; r++) {
		let i = e[r], a = t(i);
		if (n) n[r] = a;
		else if (a !== i) {
			n = Array(e.length);
			for (let t = 0; t < r; t++) n[t] = e[t];
			n[r] = a;
		}
	}
	return n ?? e;
}
function fc(e, t) {
	return tc(e, e.context ? new Yo(e.context.isOptional, e.context.isMutable, e.context.constructorDefault, {
		...e.context.annotations,
		...t
	}) : new Yo(!1, !1, void 0, t));
}
var pc = /*#__PURE__*/ u((e) => mc(tc(e, e.context ? e.context.isOptional === !1 ? new Yo(!0, e.context.isMutable, e.context.constructorDefault, e.context.annotations) : e.context : new Yo(!0, !1)))), mc = /*#__PURE__*/ cc(pc);
function hc(e, t, n) {
	return uc(e, n, t);
}
function gc(e) {
	return e.context?.isOptional ?? !1;
}
function _c(e) {
	return e.annotations?.["~structural"] === !0 || e._tag === "FilterGroup" && e.checks.every(_c);
}
function vc(e) {
	function t(e) {
		return _c(e) ? [e] : e._tag === "FilterGroup" ? e.checks.flatMap(t) : [];
	}
	let n = e.flatMap(t);
	return _n(n) ? n : void 0;
}
function yc(e) {
	let t = !0;
	function n(e) {
		return t = t && !e.encoding && !qo(e), t && "recur" in e && e.recur(n), e;
	}
	return "recur" in e && e.recur(n), t;
}
var bc = /*#__PURE__*/ u((e) => {
	let t = ec(e);
	if (t !== e) {
		let n = bc(t);
		return n === t && e.encoding === void 0 ? e : tc(n, e.context);
	}
	let n = "recur" in e ? e.recur(bc) : e;
	if ("encodingChecks" in n && n.encodingChecks) {
		let t = yc(e) ? n.encodingChecks : Go(n) || Ko(n) || Vo(n) && n.typeParameters.length > 0 ? vc(n.encodingChecks) : void 0;
		return $s(n, {
			encodingChecks: void 0,
			checks: Ts(n.checks, t)
		});
	}
	return n;
}), xc = /*#__PURE__*/ u((e) => bc(Cc(e)));
function Sc(e, t) {
	let n = t, r = n.length, i = n[r - 1], a = [new Y(Cc(Z(e, void 0)), n[0].transformation.flip())];
	for (let e = 1; e < r; e++) a.unshift(new Y(Cc(n[e - 1].to), n[e].transformation.flip()));
	let o = Cc(i.to);
	return o.encoding ? Z(o, [...o.encoding, ...a]) : Z(o, a);
}
var Cc = /*#__PURE__*/ l((e) => {
	if (e.encoding) return Sc(e, e.encoding);
	let t = ec(e);
	if (t !== e) {
		let n = Cc(t);
		return n === t ? e : tc(n, e.context);
	}
	return "flip" in e ? e.flip(Cc) : "recur" in e ? e.recur(Cc) : e;
});
function wc(e) {
	switch (e._tag) {
		case "Undefined": return !0;
		case "Union": return e.types.some(wc);
		default: return !1;
	}
}
function Tc(e, t) {
	let n = t === 0 ? K : W(t);
	return (r, i) => r === U ? G : r === t ? n : B(new oo(e, r, i));
}
function Ec(e, t) {
	return (n, r) => n === U ? G : t(n) ? K : B(new oo(e, n, r));
}
var Dc = /*#__PURE__*/ lc((e) => {
	switch (e._tag) {
		default: return e;
		case "Number": return e.toCodecStringTree();
		case "Union": return e.recur(Dc);
	}
}), Oc = /*#__PURE__*/ new globalThis.RegExp(`^${ps}$`), kc = /*#__PURE__*/ new globalThis.RegExp(`^(?:${ps}|Infinity|-Infinity|NaN)$`);
function Ac(e) {
	return Zs(Oc, {
		expected: "a string representing a finite number",
		representation: {
			id: "effect/schema/isStringFinite",
			payload: null
		},
		toJsonSchema: () => ({ pattern: Oc.source }),
		...e
	});
}
var jc = /*#__PURE__*/ ac(ns, [/*#__PURE__*/ Ac()]), Mc = /*#__PURE__*/ new Y(jc, zo), Nc = /*#__PURE__*/ new Y(/*#__PURE__*/ new Ls([jc, Us]), zo);
function Pc(e, t, n, r, i) {
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		if (o._tag === "FilterGroup") {
			if (n = Pc(o.checks, t, n, r, i), n && (i.errors !== "all" || n[n.length - 1].filter.aborted)) return n;
		} else {
			let e = o.run(t, r, i);
			if (e) {
				let r = new to(o, e, t, i);
				if (n ? n.push(r) : n = [r], i.errors !== "all" || o.aborted) return n;
			}
		}
	}
	return n;
}
function Fc(e) {
	if (!Vo(e)) return;
	let t = e.annotations?.[Ja];
	return ie(t) ? t(e.typeParameters) : void 0;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/schema/interpreter.js
var Ic = (e, t, n) => e === K ? n(t) : H(e, n);
function Lc(e) {
	if (e._tag === "Middleware") return (t, n, r) => Rc(t === K ? e.decode(W(Xa(n)), r) : e.decode(Va(t, Xa), r));
	let t = e.decode;
	switch (t._tag) {
		case "Passthrough": return (e, t) => e === K ? W(t) : e;
		case "Transform": {
			let e = (e) => e === U ? G : W(t.transform(e));
			return (t, n) => Ic(t, n, e);
		}
		case "TransformOptional": {
			let e = (e) => Za(t.transform(Xa(e)));
			return (t, n) => Ic(t, n, e);
		}
		case "TransformEffect": return (e, n, r) => Ic(e, n, (e) => e === U ? G : t.transform(e, r));
		case "TransformOptionalEffect": return (e, n, r) => Ic(e, n, (e) => Rc(t.transform(Xa(e), r)));
	}
}
var Rc = (e) => H(e, Za), zc = (e, t, n, r) => za(r, (r) => Ia(() => Ca(r, (r) => new no(e, r, t, n))));
function Bc(e, t) {
	let n = Lc(e.link.transformation), r;
	return (i, a) => {
		if (i === U) return G;
		if (e.isConstructed(i)) return K;
		let o = (r ??= t(e.link.to))(i, a);
		return n(o, i, a);
	};
}
function Vc(e, t) {
	let n = e.context.constructorDefault;
	return (r, i) => {
		if (r !== U && r !== void 0) return t(r, i);
		let a = n;
		if (R(a) && a._tag === "Success") {
			let e = t(a[E], i);
			return e === K ? a : e;
		}
		return H(zc(e, r, i, a), (e) => {
			let n = t(e, i);
			return n === K ? W(e) : n;
		});
	};
}
function Hc(e, t) {
	let n = t(e);
	return e.context?.constructorDefault === void 0 ? n : Vc(e, n);
}
function Uc(e, t, n, r, i) {
	if (e._tag === "Declaration") for (let n of e.typeParameters) t(n);
	let a = n ? Fc(e) : void 0, o = a ? Bc(a, t) : r ?? e.getParser(t, n), s = e.checks, c = e.encoding, l = c?.map((e) => Lc(e.transformation)), u = e.encodingChecks;
	if (!c && !s && !u) return o;
	let d, f = (t, n) => {
		let r = o(t, n);
		if (u && !n.disableChecks) {
			if (R(r)) {
				if (r._tag === "Success") {
					let i = r === K ? t : r[E];
					if (t !== U && i !== U) {
						let i = Pc(u, t, void 0, e, n);
						i && (r = B(new J(e, i, t, n)));
					}
				}
			} else r = V(r, (r) => {
				if (t !== U && r !== U) {
					let r = Pc(u, t, void 0, e, n);
					if (r) return B(new J(e, r, t, n));
				}
				return Pa(r);
			});
		}
		if (s && !n.disableChecks) {
			if (R(r)) {
				if (r._tag === "Success") {
					let i = r === K ? t : r[E];
					if (i === U) return r;
					let a = Pc(s, i, void 0, e, n);
					a && (r = B(new J(e, a, i, n)));
				}
			} else r = V(r, (t) => {
				if (t !== U) {
					let r = Pc(s, t, void 0, e, n);
					if (r) return B(new J(e, r, t, n));
				}
				return Pa(t);
			});
		}
		return r;
	}, p = i === void 0 ? f : i(f);
	return c ? (n, r) => {
		let i = d ??= c.map((e) => t(e.to)), a = n, o = i[i.length - 1](n, r);
		for (let e = c.length - 1; e >= 0; e--) if (o = l[e](o, a, r), e !== 0) {
			let t = i[e - 1];
			o._tag === "Success" ? (a = o[E], o = t(a, r)) : o = H(o, (e) => {
				let n = t(e, r);
				return n === K ? W(e) : n;
			});
		}
		if (o._tag === "Success") {
			let e = o[E], t = p(e, r);
			return t === K ? o : t;
		}
		return o = zc(e, n, r, o), H(o, (e) => {
			let t = p(e, r);
			return t === K ? W(e) : t;
		});
	} : p;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/internal/schema/compilerRegistry.js
var Wc = /*#__PURE__*/ Symbol(), Gc = /*#__PURE__*/ new WeakMap(), Kc = (e) => Xc(e).parser, qc = (e) => Xc(e).makeEffect, Jc = (e) => Hc(e, qc), Yc = class {
	ast;
	constructor(e) {
		this.ast = e;
	}
	get decodeEffect() {
		return this.cachedDecodeEffect ??= Uc(this.ast, Kc);
	}
	get parser() {
		return this.decodeEffect;
	}
	get makeEffect() {
		return this.cachedMakeEffect ??= Uc(this.ast, qc, Jc);
	}
};
function Xc(e) {
	let t = Gc.get(e);
	if (t !== void 0) return t;
	let n = new Yc(e);
	return Gc.set(e, n), n;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/SchemaParser.js
function Zc(e) {
	let t = e.ast, n;
	return (e, r) => (n ??= al(ll, bc(t)))(e, r?.disableChecks ? r?.parseOptions ? {
		...r.parseOptions,
		disableChecks: !0
	} : { disableChecks: !0 } : r?.parseOptions);
}
function Qc(e) {
	let t = Zc(e);
	return (e, n) => {
		let r = Ba(t(e, n));
		return Oa(r) ? mn(r.value) : (To(r.cause, "Option adapter can only return none for schema issues"), pn());
	};
}
function $c(e) {
	return sl(bc(e.ast));
}
function el(e, t) {
	let n = rl(e.ast);
	return t === void 0 ? n : (e, r) => n(e, tl(t, r));
}
var tl = (e, t) => t ? {
	...e,
	...t
} : e, nl = (e) => e === U ? B(new so()) : Pa(e);
function rl(e) {
	return al(cl, e);
}
function il(e, t) {
	return e === K ? Pa(t) : R(e) ? e["~effect/Effect/args"] === U ? nl(U) : e : H(e, nl);
}
function al(e, t) {
	let n;
	return (r, i) => {
		let a = (n ??= e(t))(r, i ?? Jo);
		return a === K ? Pa(r) : R(a) ? a["~effect/Effect/args"] === U ? nl(U) : a : H(a, nl);
	};
}
function ol(e, t) {
	let n = Ba(e);
	if (Oa(n)) return n.value;
	let r = To(n.cause, t);
	throw Error("Schema validation failed", { cause: r });
}
function sl(e) {
	let t, n;
	return (r, i) => {
		t ??= Xc(e);
		let a = i?.disableChecks ? i.parseOptions ? {
			...i.parseOptions,
			disableChecks: !0
		} : { disableChecks: !0 } : i?.parseOptions ?? Jo, o = t.make;
		if (o !== void 0 && r !== U) {
			let e;
			try {
				e = o(r, a);
			} catch (e) {
				throw To(Sa(e), "Constructor adapter can only throw schema issues"), e;
			}
			if (e !== Wc && e !== U) return e;
		}
		return ol(il((n ??= t.makeEffect)(r, a), r), "Constructor adapter can only throw schema issues");
	};
}
var cl = (e) => Xc(e).parser, ll = (e) => Xc(e).makeEffect, ul = "~effect/Schema/Schema", dl = /*#__PURE__*/ Symbol(), fl = {
	[ul]: ul,
	get make() {
		let e = $c(this);
		return Object.defineProperty(this, "make", {
			value: e,
			enumerable: !0
		}), e;
	},
	get makeEffect() {
		let e = Zc(this);
		return Object.defineProperty(this, "makeEffect", {
			value: e,
			enumerable: !0
		}), e;
	},
	get makeOption() {
		let e = Qc(this);
		return Object.defineProperty(this, "makeOption", {
			value: e,
			enumerable: !0
		}), e;
	},
	pipe() {
		return e(this, arguments);
	},
	annotate(e) {
		return this.rebuild(rc(this.ast, e));
	},
	annotateKey(e) {
		return this.rebuild(fc(this.ast, e));
	},
	check(...e) {
		return this.rebuild(ac(this.ast, e));
	},
	rebuild(e) {
		return pl(e, this[dl]);
	}
};
function pl(e, t) {
	function n() {}
	let r = Object.setPrototypeOf(n, fl);
	return t && (Object.hasOwn(t, "name") || Object.hasOwn(t, "length") || Object.hasOwn(t, "__proto__")) ? Object.defineProperties(r, Object.getOwnPropertyDescriptors({ ...t })) : Object.assign(r, t), r[dl] = t, r.ast = e, r;
}
// ../../node_modules/.pnpm/effect@4.0.5/node_modules/effect/dist/Struct.js
var ml = (e) => e, hl = "~effect/Schema/SchemaError";
function gl(e) {
	return h(e, "~effect/Schema/SchemaError") && e["~effect/Schema/SchemaError"] === "~effect/Schema/SchemaError";
}
({ ...T }), { ...T }, { ...T }, { ...T }, { ...T }, { ...T }, { ...T }, { ...T };
var _l = class extends (/*#__PURE__*/ ri("SchemaError")) {
	[hl] = hl;
	constructor(e) {
		let t = et();
		tt(0);
		try {
			super({ issue: e });
		} finally {
			tt(t);
		}
	}
	get message() {
		return xo(this.issue);
	}
	toJSON() {
		return {
			_tag: this._tag,
			message: this.message
		};
	}
	[w]() {
		return this.toJSON();
	}
	toString() {
		return `SchemaError(${this.message})`;
	}
};
function vl(e) {
	return gl(e);
}
function yl(e) {
	return R(e) ? bl(e) : za(e, (e) => Ia(() => Ca(e, (e) => new _l(e))));
}
function bl(e) {
	return Oa(e) ? e : Ta(Ca(e.cause, (e) => new _l(e)));
}
function xl(e, t) {
	let n;
	for (let r of e.reasons) {
		if (!xa(r) || !vl(r.error)) throw new globalThis.Error(t, { cause: e });
		n ??= r.error;
	}
	if (n === void 0) throw new globalThis.Error(t, { cause: e });
	return n;
}
function Sl(e) {
	let t = Ba(e);
	if (Oa(t)) return t.value;
	throw xl(t.cause, "Sync adapter can only throw schema errors");
}
function Cl(e, t) {
	let n = el(e, t);
	return (e, t) => yl(n(e, t));
}
function wl(e, t) {
	let n = Cl(e, t);
	return (e, t) => Sl(n(e, t));
}
var Q = pl, Tl = /*#__PURE__*/ ml((e) => Q(pc(e.ast), { schema: e }));
function El(e) {
	let t = Q(new es(e), {
		literal: e,
		transform(n) {
			return t.pipe(Il(El(n), {
				decode: ko(() => n),
				encode: ko(() => e)
			}));
		}
	});
	return t;
}
var Dl = /*#__PURE__*/ Q(Qo), Ol = /*#__PURE__*/ Q(ns), kl = /*#__PURE__*/ Q(as), Al = /*#__PURE__*/ Q(os);
function jl(e, t) {
	return Q(e, {
		fields: t,
		mapFields(e, t) {
			let n = e(this.fields);
			return jl(Es(n, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function $(e) {
	return jl(Es(e, void 0), e);
}
var Ml = /*#__PURE__*/ ml((e) => Q(new ss(!1, [], [e.ast]), { value: e }));
function Nl(e, t) {
	return Q(e, {
		members: t,
		mapMembers(e, t) {
			let n = e(this.members);
			return Nl(Os(n, this.ast.options, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function Pl(e, t) {
	return Nl(Os(e, t, void 0), e);
}
function Fl(e) {
	let t = e.map(El);
	return Q(Os(t, void 0, void 0), {
		literals: e,
		members: t,
		mapMembers(e) {
			return Pl(e(this.members));
		},
		pick(e) {
			return Fl(e);
		},
		transform(e) {
			return Pl(t.map((t, n) => t.transform(e[n])));
		}
	});
}
function Il(e, t) {
	return (n) => Q(hc(n.ast, e.ast, t ? Io(t) : Ro()), {
		from: n,
		to: e
	});
}
var Ll = Js;
function Rl(e, t) {
	let n = e.source, r = e.flags, i = /^[dg]*uy?$/.test(r), a = r === "" ? `new RegExp(${C(n)})` : `new RegExp(${C(n)}, ${C(r)})`;
	return Zs(e, {
		toJsonSchema: () => i ? { pattern: r.endsWith("y") ? `^(?:${n})` : n } : [{}, !0],
		toCode: () => ({ runtime: `Schema.isPattern(${a})` }),
		...t
	});
}
function zl(e) {
	let t = un(e.order), n = e.formatter ?? C;
	return (r, i) => Ll((e) => t(e, r), {
		expected: `a value greater than ${n(r)}`,
		arbitraryConstraint: {
			order: e.order,
			minimum: r,
			exclusiveMinimum: !0
		},
		...e.annotate?.(r),
		...i
	});
}
function Bl(e) {
	let t = dn(e.order), n = e.formatter ?? C;
	return (r, i) => Ll((e) => t(e, r), {
		expected: `a value less than or equal to ${n(r)}`,
		arbitraryConstraint: {
			order: e.order,
			maximum: r
		},
		...e.annotate?.(r),
		...i
	});
}
function Vl(e) {
	let t = fn(e.order), n = un(e.order), r = dn(e.order), i = ln(e.order), a = e.formatter ?? C;
	return (o, s) => {
		let c = o.exclusiveMinimum ? n : t, l = o.exclusiveMaximum ? i : r;
		return Ll((e) => c(e, o.minimum) && l(e, o.maximum), {
			expected: `a value between ${a(o.minimum)}${o.exclusiveMinimum ? " (excluded)" : ""} and ${a(o.maximum)}${o.exclusiveMaximum ? " (excluded)" : ""}`,
			arbitraryConstraint: {
				order: e.order,
				minimum: o.minimum,
				maximum: o.maximum,
				...o.exclusiveMinimum && { exclusiveMinimum: !0 },
				...o.exclusiveMaximum && { exclusiveMaximum: !0 }
			},
			...e.annotate?.(o),
			...s
		});
	};
}
function Hl(e) {
	if (!globalThis.Number.isFinite(e)) throw new globalThis.RangeError(`Expected a finite number, got ${C(e)}`);
	return e;
}
var Ul = /*#__PURE__*/ zl({
	order: cn,
	annotate: (e) => ({
		representation: {
			id: "effect/schema/isGreaterThan",
			payload: { exclusiveMinimum: Hl(e) }
		},
		toJsonSchema: () => ({ exclusiveMinimum: e }),
		toCode: () => ({ runtime: `Schema.isGreaterThan(${C(e)})` })
	})
}), Wl = /*#__PURE__*/ Bl({
	order: cn,
	annotate: (e) => ({
		representation: {
			id: "effect/schema/isLessThanOrEqualTo",
			payload: { maximum: Hl(e) }
		},
		toJsonSchema: () => ({ maximum: e }),
		toCode: () => ({ runtime: `Schema.isLessThanOrEqualTo(${C(e)})` })
	})
}), Gl = /*#__PURE__*/ Vl({
	order: cn,
	annotate: (e) => {
		let t = e.exclusiveMinimum ? !0 : void 0, n = e.exclusiveMaximum ? !0 : void 0;
		return {
			representation: {
				id: "effect/schema/isBetween",
				payload: {
					minimum: Hl(e.minimum),
					maximum: Hl(e.maximum),
					...t && { exclusiveMinimum: t },
					...n && { exclusiveMaximum: n }
				}
			},
			toJsonSchema: () => ({
				[t ? "exclusiveMinimum" : "minimum"]: e.minimum,
				[n ? "exclusiveMaximum" : "maximum"]: e.maximum
			}),
			toCode: () => ({ runtime: `Schema.isBetween({ minimum: ${C(e.minimum)}, maximum: ${C(e.maximum)}, exclusiveMinimum: ${C(t)}, exclusiveMaximum: ${C(n)} })` })
		};
	}
});
function Kl(e) {
	return Ll((e) => globalThis.Number.isSafeInteger(e), {
		expected: "an integer",
		representation: {
			id: "effect/schema/isInt",
			payload: null
		},
		toJsonSchema: () => ({
			type: "integer",
			minimum: globalThis.Number.MIN_SAFE_INTEGER,
			maximum: globalThis.Number.MAX_SAFE_INTEGER
		}),
		toCode: () => ({ runtime: "Schema.isInt()" }),
		arbitraryConstraint: { number: "integer" },
		...e
	});
}
var ql = /*#__PURE__*/ kl.check(/*#__PURE__*/ Kl());
function Jl(e, t) {
	return e = Zl(e), Yl(e, Math.ceil(e / 2), t);
}
function Yl(e, t, n) {
	return Ll((t) => t.length >= e, {
		expected: `a value with a length of at least ${e}`,
		representation: {
			id: "effect/schema/isMinLength",
			payload: { minLength: e }
		},
		toJsonSchema: ({ type: n }) => n === "string" ? e <= 1 ? { minLength: t } : [{ minLength: t }, !0] : n === "array" ? { minItems: e } : n === void 0 ? [{
			minLength: t,
			minItems: e
		}, !0] : [{}, !0],
		toCode: () => ({ runtime: `Schema.isMinLength(${e})` }),
		[Ka]: !0,
		arbitraryConstraint: { minLength: e },
		...n
	});
}
function Xl(e, t) {
	return e = Zl(e), Ll((t) => t.length <= e, {
		expected: `a value with a length of at most ${e}`,
		representation: {
			id: "effect/schema/isMaxLength",
			payload: { maxLength: e }
		},
		toJsonSchema: ({ type: t }) => t === "string" ? e === 0 ? { maxLength: e } : [{ maxLength: e }, !0] : t === "array" ? { maxItems: e } : t === void 0 ? [{
			maxLength: e,
			maxItems: e
		}, !0] : [{}, !0],
		toCode: () => ({ runtime: `Schema.isMaxLength(${e})` }),
		[Ka]: !0,
		arbitraryConstraint: { maxLength: e },
		...t
	});
}
function Zl(e) {
	if (!globalThis.Number.isFinite(e)) throw new globalThis.RangeError(`Expected a finite number, got ${e}`);
	return Math.max(0, Math.floor(e));
}
globalThis.RegExp, globalThis.URL, globalThis.File, globalThis.FormData, globalThis.URLSearchParams, globalThis.Uint8Array;
var Ql = [
	"owner",
	"engine",
	"project-lead",
	"orchestrator",
	"planning-lead",
	"planner",
	"reviewer",
	"design-lead",
	"designer",
	"build-lead",
	"build-init",
	"builder",
	"test-runner",
	"evaluator"
], $l = Ol.check(Jl(1), Xl(200)), eu = Ol.check(Rl(/^[a-z0-9][a-z0-9-]{0,63}$/)), tu = ql.check(Ul(0), Wl(1e3)), nu = $({
	tests: Al,
	agentReview: Al,
	fullReviewRounds: tu,
	approvalAfterRound: tu,
	maxReviewRounds: Pl([tu, Dl]),
	stuckPoints: tu,
	stuckShare: ql.check(Gl({
		minimum: 1,
		maximum: 100
	})),
	stuckRounds: tu,
	autoMergeFix: Al
}), ru = $({
	id: eu,
	name: $l,
	end: Tl(Al),
	role: Fl(Ql),
	steps: Ml($({
		from: $l,
		to: $l,
		when: $l,
		role: Fl(Ql)
	})).check(Xl(100))
}), iu = $({
	version: El(1),
	name: $l,
	settings: nu,
	phases: Ml($({
		id: eu,
		name: $l,
		blocks: Ml(ru).check(Jl(1), Xl(100))
	})).check(Jl(1), Xl(24)),
	moves: Ml($({
		from: eu,
		to: eu,
		when: $l
	})).check(Xl(1e3))
}), au = (e) => {
	let t = /* @__PURE__ */ new Set();
	for (let n of e.phases) {
		if (!n.name.trim()) return "Give every phase a name.";
		if (t.has(n.id)) return "Give every phase and block a unique identifier.";
		t.add(n.id);
		for (let e of n.blocks) {
			if (!e.name.trim()) return "Give every block a name.";
			if (t.has(e.id)) return "Give every phase and block a unique identifier.";
			if (t.add(e.id), e.steps.some((e) => !e.from.trim() || !e.to.trim() || !e.when.trim())) return "Give every inner move a source, target and condition.";
		}
	}
	let n = new Set(e.phases.flatMap((e) => e.blocks.map((e) => e.id))), r = /* @__PURE__ */ new Set();
	for (let t of e.moves) {
		if (!n.has(t.from) || !n.has(t.to)) return "Every move must connect two existing blocks.";
		if (!t.when.trim()) return "Give every move a condition.";
		if (t.from === t.to) return "A move must connect two different blocks.";
		let e = JSON.stringify([
			t.from,
			t.to,
			t.when
		]);
		if (r.has(e)) return "Remove the duplicate move.";
		r.add(e);
	}
	if (!e.name.trim()) return "Give the workflow a name.";
	if (e.settings.approvalAfterRound < e.settings.fullReviewRounds) return "Ask for approval after the full review rounds.";
	if (e.settings.maxReviewRounds !== null && e.settings.maxReviewRounds < e.settings.approvalAfterRound) return "Keep the review limit at or above the approval round.";
}, ou = iu.check(Ll((e) => au(e))), su = (e) => {
	if (typeof e == "object" && e) {
		let t = e;
		if (typeof t.name == "string" && !t.name.trim()) return "Give the workflow a name.";
		if (Array.isArray(t.phases)) {
			if (!t.phases.length || t.phases.length > 24) return "Keep between one and 24 phases.";
			for (let e of t.phases) {
				if (typeof e?.name == "string" && !e.name.trim()) return "Give every phase a name.";
				if (Array.isArray(e?.blocks)) {
					if (!e.blocks.length || e.blocks.length > 100) return "Keep between one and 100 blocks in every phase.";
					for (let t of e.blocks) {
						if (typeof t?.name == "string" && !t.name.trim()) return "Give every block a name.";
						if (t?.role && !Ql.includes(t.role)) return "Choose a supported role for every block.";
					}
				}
			}
		}
		if (t.settings && typeof t.settings == "object") {
			for (let [e, n] of Object.entries(t.settings)) if (![
				"tests",
				"agentReview",
				"autoMergeFix"
			].includes(e) && (e !== "maxReviewRounds" || n !== null) && (!Number.isInteger(n) || Number(n) < 1 || Number(n) > (e === "stuckShare" ? 100 : 1e3))) return "Use positive whole numbers within the setting limits.";
		}
	}
	try {
		wl(iu)(e, { onExcessProperty: "error" });
	} catch {
		return "Use the workflow format with named phases and blocks, supported roles, and valid settings.";
	}
	return au(e);
};
$({
	...$({
		scope: Fl([
			"default",
			"user",
			"repository"
		]),
		id: Ol,
		name: Ol,
		readOnly: Al,
		error: Tl(Ol),
		canDelete: Tl(Al)
	}).fields,
	definition: ou
}), $({
	scope: Fl(["user", "repository"]),
	limit: ql,
	truncated: Al,
	error: Tl(Ol)
});
export { su as validateWorkflow, Ql as workflowRoles };
