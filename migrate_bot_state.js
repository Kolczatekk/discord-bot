const { createClient } = require("@supabase/supabase-js");

const OLD_URL = "https://wtrgebczyqumyyrnagus.supabase.co";
const OLD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0cmdlYmN6eXF1bXl5cm5hZ3VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNzQxMzcsImV4cCI6MjA4MzY1MDEzN30.DfoskyY-P5llIM3lXyEhHDBfqX2VoNIw1AADPcgHm1Q";

const NEW_URL = "https://esckymvfxkpagbhhivgu.supabase.co";
const NEW_KEY = "sb_publishable_wydMGaFmaLOrVTlBNxW04g_lwNmRhNz"; 

const oldClient = createClient(OLD_URL, OLD_KEY);
const newClient = createClient(NEW_URL, NEW_KEY);

async function run() {
  console.log("Reading bot_state from old database...");
  const { data, error } = await oldClient.from("bot_state").select("*");
  if (error) {
    console.error("Error reading bot_state:", error.message);
    return;
  }
  if (!data || data.length === 0) {
    console.log("No data found in old bot_state.");
    return;
  }

  console.log("Found bot_state row. Inserting/updating in new database...");
  const cleanedData = data.map(row => {
    const { created_at, ...rest } = row;
    return rest;
  });
  const { error: insertError } = await newClient.from("bot_state").upsert(cleanedData);
  if (insertError) {
    console.error("Error inserting bot_state to new database:", insertError.message);
  } else {
    console.log("✅ Pomyślnie przeniesiono stan bota (w tym zaproszenia) do nowej bazy!");
  }
}

run();
