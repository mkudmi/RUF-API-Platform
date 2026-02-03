fn main() {
    println!("cargo:rerun-if-changed=permissions");
    tauri_build::build()
}
