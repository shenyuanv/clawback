function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function writeStderr(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function writeLine(text: string): Promise<void> {
  await writeStdout(`${text}\n`);
}

export { writeStdout, writeStderr, writeLine };
