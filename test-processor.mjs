import { processBill } from './src/lib/processor.js';

async function run() {
  console.log("Starting processBill...");
  try {
    await processBill('383e8447-cce4-4ba8-9345-52c4c57751bc');
    console.log("Done!");
  } catch (err) {
    console.error("Failed:", err);
  }
}
run();
