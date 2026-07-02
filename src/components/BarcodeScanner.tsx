import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import "./BarcodeScanner.css";

type BarcodeScannerProps = {
  onScanSuccess: (codigo: string) => void;
  onClose: () => void;
};

const READER_ID = "optima-barcode-reader";

function BarcodeScanner({ onScanSuccess, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerActivoRef = useRef(false);
  const yaEscaneoRef = useRef(false);
  const [error, setError] = useState("");

  async function detenerScanner() {
    const scanner = scannerRef.current;

    if (!scanner) return;

    try {
      if (scannerActivoRef.current) {
        await scanner.stop();
        scannerActivoRef.current = false;
      }

      await scanner.clear();
    } catch (error) {
      console.warn("No se pudo detener el escáner:", error);
    }
  }

  useEffect(() => {
    let componenteMontado = true;

    async function iniciarScanner() {
      try {
        setError("");

        const scanner = new Html5Qrcode(READER_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: {
              width: 280,
              height: 160,
            },
            aspectRatio: 1.777778,
          },
          async (decodedText: string) => {
            if (yaEscaneoRef.current) return;

            yaEscaneoRef.current = true;

            const codigoLimpio = decodedText.trim();

            await detenerScanner();

            if (componenteMontado) {
              setTimeout(() => {
                onScanSuccess(codigoLimpio);
              }, 150);
            }
          },
          () => {
            // Es normal que falle muchas veces mientras busca el código.
            // No mostramos esos errores porque ensucian la pantalla.
          }
        );

        scannerActivoRef.current = true;

        if (!componenteMontado) {
          await detenerScanner();
        }
      } catch (error) {
        console.error("Error al iniciar el escáner:", error);

        if (componenteMontado) {
          setError(
            "No se pudo abrir la cámara. Revisá los permisos o probá nuevamente."
          );
        }
      }
    }

    iniciarScanner();

    return () => {
      componenteMontado = false;
      detenerScanner();
    };
  }, [onScanSuccess]);

  async function cerrarManual() {
    await detenerScanner();
    onClose();
  }

  return (
    <div className="scanner-overlay">
      <div className="scanner-card">
        <div className="scanner-header">
          <div>
            <h2>Escanear código</h2>
            <p>Apuntá la cámara al código de barras del producto.</p>
          </div>

          <button className="scanner-close" type="button" onClick={cerrarManual}>
            ✕
          </button>
        </div>

        <div id={READER_ID} className="scanner-reader" />

        {error && <p className="scanner-error">{error}</p>}

        <button className="scanner-cancel-button" type="button" onClick={cerrarManual}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default BarcodeScanner;

