use serde_json::Value;

/// Deterministic canonical JSON serialization.
///
/// Rules:
/// * Object keys sorted lexicographically (byte order).
/// * No whitespace between tokens.
/// * Strings escaped per RFC 8259 with the shortest valid form produced by
///   `serde_json`. Numbers keep their `serde_json` round-trip form.
///
/// The Ed25519 signature MUST cover exactly this canonical form so that any
/// byte-level modification of signed fields invalidates the license.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => {
            let esc = serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into());
            out.push_str(&esc);
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // Deterministic ordering via BTreeMap, independent of serde_json features.
            let mut sorted: Vec<(&String, &Value)> = map.iter().collect();
            sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
            out.push('{');
            for (i, (k, v)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                let esc = serde_json::to_string(k).unwrap_or_else(|_| "\"\"".into());
                out.push_str(&esc);
                out.push(':');
                write_canonical(v, out);
            }
            out.push('}');
        }
    }
}

/// Parse then canonicalize in one step.
pub fn canonicalize_str(json: &str) -> Result<String, serde_json::Error> {
    let v: Value = serde_json::from_str(json)?;
    Ok(canonical_json(&v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_keys_and_strips_whitespace() {
        let v = json!({ "b": 1, "a": { "z": true, "y": [3, 1] } });
        assert_eq!(canonical_json(&v), r#"{"a":{"y":[3,1],"z":true},"b":1}"#);
    }

    #[test]
    fn is_stable_across_input_ordering() {
        let a = canonicalize_str(r#"{"x":1,"y":"س"}"#).unwrap();
        let b = canonicalize_str(r#" { "y" : "س" , "x" : 1 } "#).unwrap();
        assert_eq!(a, b);
        assert_eq!(a, r#"{"x":1,"y":"س"}"#);
    }
}
