import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import "./BarcodeScanner.css";

type BarcodeScannerProps = {
  onScanSuccess: (codigo: string) => void;
  onClose: () => void;
};

const READER_ID = "reader";

function BarcodeScanner({ onScanSuccess, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const yaEscaneoRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: {
            width: 250,
            height: 160,
          },
        },
        async (decodedText) => {
          if (yaEscaneoRef.current) return;

          yaEscaneoRef.current = true;

          try {
            await scanner.stop();
            await scanner.clear();
          } catch (error) {
            console.warn("No se pudo cerrar el scanner:", error);
          }

          onScanSuccess(decodedText);
        },
        () => {
          // Es normal que falle muchas veces mientras busca el código.
          // Por eso no mostramos esos errores en pantalla.
        }
      )
      .catch((error) => {
        console.error("Error al abrir la cámara:", error);
        setError(
          "No se pudo abrir la cámara. Revisá los permisos o probá desde el celular con HTTPS."
        );
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {
            // Si ya estaba cerrado, no hacemos nada.
          });
      }
    };
  }, [onScanSuccess]);

  async function cerrarScanner() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      }
    } catch (error) {
      console.warn("No se pudo cerrar manualmente el scanner:", error);
    }

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

          <button className="scanner-close" type="button" onClick={cerrarScanner}>
            ✕
          </button>
        </div>

        <div id={READER_ID} className="scanner-reader" />

        {error && <p className="scanner-error">{error}</p>}

        <button className="scanner-cancel-button" type="button" onClick={cerrarScanner}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default BarcodeScanner;
