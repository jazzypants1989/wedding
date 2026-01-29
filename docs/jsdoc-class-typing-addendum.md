# JSDoc Class Typing: Addendum and Corrections

This document supplements `jsdoc-class-typing-patterns.md` with additional experiments, corrections, and newly discovered patterns.

---

## Critical Correction: Factory Functions Don't Solve Generics

The original document claims factory functions with manual prototypes are the "holy grail" where "generic methods just work at call sites." **This is incorrect.**

### What Actually Happens

```js
/** @type {Types.createQuery} */
export function createQuery(sql, params) {
  const obj = Object.create(Query.prototype)
  obj.get = function() { return { id: 1, name: "Alice" } }
  return obj
}

const q = createQuery("SELECT * FROM users", [])
const user = q.get()  // Type: unknown | undefined — NOT User!
```

The generic type parameter `T` in `get<T>(): T | undefined` defaults to `unknown` because there's no way to specify it in JSDoc at the call site.

### Why This Matters

TypeScript cannot infer `T` from:
- The return value (it's unknown at compile time)
- The SQL string (no template literal type magic)
- Nothing else provides type information

**Generics remain unbound unless explicitly specified.** The factory pattern moves casts around but doesn't eliminate them.

---

## The Real Solution: Typed Wrapper Functions

The codebase actually solves this problem differently—with **typed wrapper functions** that encapsulate untyped generic calls:

```ts
// types.d.ts
export type getUser = (id: number) => User | undefined
export type getAllUsers = () => User[]
```

```js
// implementation.js
/** @type {Types.getUser} */
export function getUser(id) {
  return sql`SELECT * FROM users WHERE id = ${id}`.get()
}

/** @type {Types.getAllUsers} */
export function getAllUsers() {
  return sql`SELECT * FROM users`.all()
}
```

```js
// usage - FULL type inference, ZERO annotations!
const user = getUser(1)       // Type: User | undefined
const users = getAllUsers()   // Type: User[]
```

### Why This Works

The wrapper function's declared return type in `.d.ts` provides the type information. The untyped `.get()` call inside returns `unknown`, but the wrapper's signature narrows it.

**This is the actual pattern used throughout the codebase**, not the factory + prototype approach.

---

## New Patterns Not In Original Document

### Pattern 1: Schema-Driven Table Queries

Use TypeScript's mapped types to infer return types from string literal table names:

```ts
// types.d.ts
interface Schema {
  users: User
  posts: Post
}

type TableQuery = <K extends keyof Schema>(table: K) => {
  get(id: number): Schema[K] | undefined
  all(): Schema[K][]
}
```

```js
// implementation.js
/** @type {Types.TableQuery} */
export function table(tableName) {
  return {
    get(id) {
      return /** @type {any} */ (db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]))
    },
    all() {
      return /** @type {any} */ (db.query(`SELECT * FROM ${tableName}`, []))
    }
  }
}
```

```js
// usage - type inferred from table name!
const user = table("users").get(1)   // Type: User | undefined
const posts = table("posts").all()   // Type: Post[]
```

**Best for:** Simple CRUD operations where table name maps directly to entity type.

---

### Pattern 2: Type Guard Callbacks

Pass a type guard function to get both compile-time inference AND runtime validation:

```js
/**
 * @param {unknown} row
 * @returns {row is Types.User}
 */
function isUser(row) {
  return (
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    "name" in row &&
    "email" in row
  )
}

/**
 * @template T
 * @param {string} sql
 * @param {unknown[]} params
 * @param {(row: unknown) => row is T} guard
 * @returns {T | undefined}
 */
export function safeGet(sql, params, guard) {
  const row = db.get(sql, ...params)
  if (row && guard(row)) return row
  return undefined
}
```

```js
// usage - type inferred from guard!
const user = safeGet("SELECT * FROM users WHERE id = 1", [], isUser)
// Type: User | undefined
```

**Best for:** Untrusted data, external APIs, or when runtime validation is required.

---

### Pattern 3: Phantom Type Markers

Use a marker object to carry type information without runtime cost:

```js
/** @type {{ User: Types.User, Post: Types.Post }} */
const $ = /** @type {any} */ ({})

/**
 * @template T
 * @param {string} sql
 * @param {unknown[]} params
 * @param {T} [_type]
 * @returns {{ get(): T | undefined, all(): T[] }}
 */
export function query(sql, params, _type) {
  return {
    get() { return /** @type {any} */ (db.get(sql, ...params)) },
    all() { return /** @type {any} */ (db.all(sql, ...params)) }
  }
}
```

```js
// usage - type from marker
const q = query("SELECT * FROM users", [], $.User)
const user = q.get()  // Type: User | undefined
```

**Best for:** Ad-hoc queries where you want inline type specification.

---

### Pattern 4: @overload for Discriminated Returns

TypeScript 5.0+ supports `@overload` in JSDoc for functions with multiple signatures:

```js
/**
 * @overload
 * @param {"user"} type
 * @param {number} id
 * @returns {Types.User | undefined}
 */
/**
 * @overload
 * @param {"post"} type
 * @param {number} id
 * @returns {Types.Post | undefined}
 */
/**
 * @param {string} type
 * @param {number} id
 */
export function getById(type, id) {
  if (type === "user") {
    return { id, name: "Alice", email: "alice@example.com" }
  }
  return { id, title: "Hello", authorId: 1 }
}
```

```js
// usage - type discriminated by first argument!
const user = getById("user", 1)  // Type: User | undefined
const post = getById("post", 1)  // Type: Post | undefined
```

**Best for:** Fixed set of known types, polymorphic APIs.

---

### Pattern 5: Const Type Parameters (TS 5.0+)

Preserve literal types through generic functions:

```ts
// types.d.ts
type createConfig = <const T extends Record<string, unknown>>(config: T) => T
```

```js
/** @type {Types.createConfig} */
export function createConfig(config) {
  return config
}

const config = createConfig({ host: "localhost", port: 3000 })
// config.host is "localhost" (literal), not string!
// config.port is 3000 (literal), not number!
```

**Best for:** Configuration objects, route definitions, constant tables.

---

## Indexed Access: Clarification

The original document recommends `@type {Types.IQuery['get']}` for methods. This **does work** syntactically, but:

```js
/** @type {Types.IQuery['get']} */
get() {
  return /** @type {any} */ (result)  // Cast STILL required
}
```

The indexed access reduces annotation lines from 2 to 1, but **does not eliminate the internal cast**. The generic `T` is part of the method signature, not the implementation scope.

### Line Count Comparison

| Approach | Annotation Lines | Internal Cast? |
|----------|-----------------|----------------|
| `@template T` + `@returns {T}` | 2 | Yes |
| `@type {I['method']}` | 1 | Yes |
| Typed wrapper function | 1 (on wrapper) | No (in wrapper) |

---

## Patterns That Don't Help

### Proxies

TypeScript cannot infer types through dynamic property access:

```js
const db = new Proxy({}, { get(_, prop) { return { get: () => {} } } })
const user = db.users.get(1)  // Type: any (no inference)
```

### Curried Factories

Currying alone doesn't provide type information:

```js
const query = (sql) => (params) => ({ get: () => {} })
const user = query("SELECT...")([ ]).get()  // Type: unknown
```

### Builder Pattern with .as<T>()

JSDoc doesn't support explicit generic arguments on method calls:

```js
// TypeScript: query.as<User>().get()
// JSDoc: NOT POSSIBLE

/** @type {Types.QueryBuilder<Types.User>} */
const typed = query.as()  // Requires annotation anyway
```

### Class-Level Generics

Moving `<T>` from methods to the class just shifts where you need the annotation:

```js
// Still need to specify T somewhere
/** @type {TypedQuery<Types.User>} */
const q = new TypedQuery("SELECT...", [])
```

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Call Sites                              │
│  const user = getUser(1)  // Full type inference            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Typed Wrapper Layer                         │
│  /** @type {Types.getUser} */                               │
│  export function getUser(id) {                              │
│    return sql`...`.get()  // Untyped inside                 │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Generic Query Layer                        │
│  class SqlFragment {                                         │
│    /** @template T @returns {T | undefined} */              │
│    get() { return /** @type {any} */ (stmt.get(...)) }      │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

**The typed wrapper layer is where type safety is enforced.** The generic query layer can remain untyped internally—it's the wrapper's declared return type that provides inference at call sites.

---

## Summary: Best Patterns by Use Case

| Use Case | Pattern | Annotations |
|----------|---------|-------------|
| Data access layer | Typed wrapper functions | 1 per function |
| Simple CRUD | Schema-driven table query | 1 on factory |
| Runtime validation | Type guard callbacks | 1 guard + 1 query |
| Ad-hoc queries | Phantom markers | Marker object + 1 |
| Fixed type sets | @overload | Multiple signatures |
| Config objects | Const generics | 1 on factory |

---

## Conclusion

The original document's "holy grail" (factory + manual prototype) doesn't actually solve the generic inference problem. **Typed wrapper functions are the real solution**—they push type information to the function signature level where TypeScript can infer it.

Generic methods with internal casts remain unavoidable at the low level. The key insight is to **encapsulate those untyped internals behind typed facades**, letting the facade's return type provide inference at call sites.
