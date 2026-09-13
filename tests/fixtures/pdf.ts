import { deflateSync } from 'node:zlib';

/** Original two-page fixture: selectable research prose + a raster-only equation. */
export function pdfFixture(): Buffer {
  const pixels = Buffer.alloc(300 * 80 * 3, 255);
  const glyphs: Record<string, string[]> = {
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
    m: ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
    c: ['00000', '00000', '01110', '10000', '10000', '10000', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  };
  for (const [index, letter] of [...'E=mc2'].entries()) {
    for (const [row, cells] of glyphs[letter]!.entries()) for (const [column, bit] of [...cells].entries()) if (bit === '1') {
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
        const x = 25 + index * 40 + column * 5 + dx; const y = (letter === '2' ? 4 : 22) + row * 5 + dy;
        const offset = (y * 300 + x) * 3; pixels.fill(25, offset, offset + 3);
      }
    }
  }
  const stream = (bytes: Buffer, extra = '') => Buffer.concat([Buffer.from(`<< /Length ${bytes.length} ${extra} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const text = Buffer.from('BT /F1 24 Tf 60 735 Td (Contextual Research Notes) Tj /F1 14 Tf 0 -45 Td (The invariant relation links mass and energy.) Tj 0 -23 Td (A quasiparticle is an effective excitation in a medium.) Tj 0 -23 Td (Its definition helps interpret neighboring paragraphs.) Tj ET');
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), stream(text),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan 8 0 R >> >> /Contents 7 0 R >>'),
    stream(Buffer.from('q 460 0 0 122.6667 65 535 cm /Scan Do Q')),
    stream(deflateSync(pixels), '/Type /XObject /Subtype /Image /Width 300 /Height 80 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'),
  ];
  let output = Buffer.from('%PDF-1.7\n'); const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output = Buffer.concat([output, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); });
  const xref = output.length;
  return Buffer.concat([output, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
}
