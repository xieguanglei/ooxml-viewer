use std::io::{Cursor, Read};

use serde::Serialize;
use wasm_bindgen::prelude::*;
use zip::read::ZipArchive;

#[derive(Serialize)]
pub struct ArchiveEntry {
    path: String,
    is_dir: bool,
    size: u64,
    content: Option<String>,
}

#[derive(Serialize)]
pub struct ArchiveSummary {
    entries: Vec<ArchiveEntry>,
}

/// Initialise shared panic hook so Rust panics show up in the browser console.
#[wasm_bindgen]
pub fn init() {
    set_panic_hook();
}

/// Inspect an OOXML archive (docx, pptx) and return its entry metadata + XML contents.
#[wasm_bindgen]
pub fn inspect_ooxml(bytes: &[u8]) -> Result<JsValue, JsValue> {
    match inspect_archive(bytes) {
        Ok(summary) => serde_wasm_bindgen::to_value(&summary).map_err(|err| err.into()),
        Err(err) => Err(JsValue::from_str(&err)),
    }
}

fn inspect_archive(bytes: &[u8]) -> Result<ArchiveSummary, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|err| err.to_string())?;

    let mut entries = Vec::with_capacity(archive.len());

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| err.to_string())?;
        let name = file.name().to_string();

        if file.is_dir() {
            entries.push(ArchiveEntry {
                path: name.trim_end_matches('/').to_string(),
                is_dir: true,
                size: 0,
                content: None,
            });
            continue;
        }

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|err| err.to_string())?;
        let size = buffer.len() as u64;

        let content = if is_textual_entry(&name) {
            let text = String::from_utf8_lossy(&buffer).into_owned();
            Some(text)
        } else {
            None
        };

        entries.push(ArchiveEntry {
            path: name,
            is_dir: false,
            size,
            content,
        });
    }

    Ok(ArchiveSummary { entries })
}

fn is_textual_entry(path: &str) -> bool {
    matches!(
        path.rsplit('.').next(),
        Some(ext) if matches!(ext.to_ascii_lowercase().as_str(), "xml" | "rels" | "txt")
    )
}

#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
    console_error_panic_hook::set_once();
}

#[cfg(not(feature = "console_error_panic_hook"))]
fn set_panic_hook() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::FileOptions;

    #[test]
    fn exposes_directory_and_xml_content() {
        let mut buffer = Vec::new();
        {
            let cursor = Cursor::new(&mut buffer);
            let mut writer = zip::ZipWriter::new(cursor);
            let options = FileOptions::default();

            writer.add_directory("word/", options).unwrap();
            writer
                .start_file("word/document.xml", options)
                .unwrap();
            writer
                .write_all(b"<w:document><w:t>Test</w:t></w:document>")
                .unwrap();
            writer.finish().unwrap();
        }

        let summary = inspect_archive(&buffer).expect("should parse zip");

        assert_eq!(summary.entries.len(), 2);
        let doc_entry = summary
            .entries
            .iter()
            .find(|entry| entry.path == "word/document.xml")
            .expect("document entry exists");

        assert_eq!(
            doc_entry.content.as_deref(),
            Some("<w:document><w:t>Test</w:t></w:document>")
        );
    }
}
