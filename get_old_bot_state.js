const { createClient } = require("@supabase/supabase-js");

const OLD_URL = "https://wtrgebczyqumyyrnagus.supabase.co";
const OLD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0cmdlYmN6eXF1bXl5cm5hZ3VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNzQxMzcsImV4cCI6MjA4MzY1MDEzN30.DfoskyY-P5llIM3lXyEhHDBfqX2VoNIw1AADPcgHm1Q";

const supabase = createClient(OLD_URL, OLD_KEY);

async function check() {
  console.log("Checking bot_state in old database...");
  try {
    const { data, error } = await supabase.from("bot_state").select("*");
    if (error) {
      console.error("Error reading bot_state:", error.message);
    } else {
      console.log(`bot_state count: ${data ? data.length : 0} rows`);
      if (data && data.length > 0) {
        console.log("Keys in data:", Object.keys(data[0]));
        console.log("First row data keys:", Object.keys(data[0].data || {}));
        if (data[0].data && data[0].data.inviteCounts) {
          console.log("inviteCounts length:", Object.keys(data[0].data.inviteCounts).length);
          console.log("inviteCounts sample:", JSON.stringify(data[0].data.inviteCounts).substring(0, 500));
        } else {
          console.log("No inviteCounts in data");
        }
      }
    }
  } catch (e) {
    console.error("Exception:", e);
  }
}

check();
