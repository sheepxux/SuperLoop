# Canonical JSON and digest interoperability

SuperLoop v1 computes every artifact SHA-256 over canonical JSON, never over YAML or pretty-printed JSON bytes. The encoding is the JSON Canonicalization Scheme (JCS) defined by [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), restricted to schema-valid JSON values:

1. Objects contain plain JSON properties only. Property names are sorted by raw UTF-16 code units.
2. Arrays retain their original order and cannot be sparse.
3. Strings use ECMAScript JSON escaping and must not contain lone Unicode surrogates. Unicode is not normalized.
4. Numbers must be finite IEEE-754 values and use ECMAScript JSON number serialization. Negative zero serializes as `0`.
5. No whitespace is emitted between tokens.
6. SHA-256 is computed over the UTF-8 bytes of that canonical string and encoded as 64 lowercase hexadecimal characters.

YAML artifacts are parsed into the JSON data model first. Comments, key order, quoting style, and whitespace therefore do not affect the digest. Duplicate keys and values outside the schema-valid JSON domain must be rejected before authorization.

This encoding is frozen for `apiVersion: superloop/v2`. A serializer change that can alter a digest requires a new protocol version; it must not silently invalidate pending decisions.

## Interoperability vector

Input data, regardless of source key order:

```json
{"b":1,"a":[3,{"z":"雪","x":true}],"n":-0}
```

Canonical UTF-8 text:

```json
{"a":[3,{"x":true,"z":"雪"}],"b":1,"n":0}
```

SHA-256:

```text
54f0fe0b4f3b0a0f8fde478c862a7a0ceb9a410f908391ccc61c58e31365c22d
```

External approval services must reproduce this vector before issuing SuperLoop digests. The reference implementation is exported as `canonicalJson()` and `sha256Json()` from `src/fs-utils.js`.
