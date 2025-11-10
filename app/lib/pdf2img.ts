export interface PdfConversionResult {
  imageUrl: string;
  file: File | null;
  error?: string;
}

let pdfjsLib: any = null;
let isLoading = false;
let loadPromise: Promise<any> | null = null;

// Use the bundled worker from pdfjs-dist so versions always match the library.
// Vite will turn this into a URL to the asset at runtime.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

async function loadPdfJs(): Promise<any> {
  if (pdfjsLib) return pdfjsLib;
  if (loadPromise) return loadPromise;

  isLoading = true;
  // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not a module
  loadPromise = import("pdfjs-dist/build/pdf.mjs").then((lib) => {
    // Set the worker source to the bundled worker URL so versions match
    try {
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    } catch (err) {
      // fallback to existing behavior
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    pdfjsLib = lib;
    isLoading = false;
    return lib;
  });

  return loadPromise;
}

export async function convertPdfToImage(
  file: File
): Promise<PdfConversionResult> {
  try {
    const lib = await loadPdfJs();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    // Try multiple scales from high -> low to avoid OOM or render failures on large PDFs.
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDimension = 4000; // maximum allowed width/height to avoid huge canvases
    const maxAllowedScale = Math.max(1, maxDimension / Math.max(baseViewport.width, baseViewport.height));

    const candidateScales = [4, 2, 1, 0.75]
      .map((s) => Math.min(s, maxAllowedScale))
      .filter((s, i, arr) => s > 0 && arr.indexOf(s) === i);

    let lastErr: any = null;
    let renderedViewport: any = null;
    let renderedCanvas: HTMLCanvasElement | null = null;

    for (const s of candidateScales) {
      const viewport = page.getViewport({ scale: s });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      if (!context) {
        lastErr = 'Canvas context unavailable';
        console.error('[pdf2img] canvas context unavailable at scale', s);
        continue;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      try {
        console.debug('[pdf2img] attempting render at scale', s, 'size', canvas.width, canvas.height);
        // await render; if it throws we'll catch and try the next scale
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await page.render({ canvasContext: context, viewport }).promise;
        // success
        renderedViewport = viewport;
        renderedCanvas = canvas;
        console.debug('[pdf2img] render succeeded at scale', s);
        break;
      } catch (err) {
        lastErr = err;
        console.error('[pdf2img] page.render error at scale', s, err);
        // try next scale
      }
    }

    if (!renderedCanvas || !renderedViewport) {
      const errMsg = lastErr ? String(lastErr) : 'Unknown render failure';
      console.error('[pdf2img] all render attempts failed', errMsg);
      return { imageUrl: '', file: null, error: `Render failed: ${errMsg}` };
    }

    return new Promise((resolve) => {
      // renderedCanvas is guaranteed here
      renderedCanvas!.toBlob(
        (blob: Blob | null) => {
          if (blob) {
            // Create a File from the blob with the same name as the pdf
            const originalName = file.name.replace(/\.pdf$/i, "");
            const imageFile = new File([blob], `${originalName}.png`, {
              type: "image/png",
            });

            resolve({
              imageUrl: URL.createObjectURL(blob),
              file: imageFile,
            });
          } else {
            resolve({
              imageUrl: "",
              file: null,
              error: "Failed to create image blob",
            });
          }
        },
        "image/png",
        1.0
      ); // Set quality to maximum (1.0)
    });
  } catch (err) {
    console.error('[pdf2img] convertPdfToImage error', err);
    return {
      imageUrl: "",
      file: null,
      error: `Failed to convert PDF: ${err}`,
    };
  }
}