// Windows release builds are GUI applications: no console window on launch.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    scheda_lib::run()
}
