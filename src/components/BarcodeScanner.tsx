import { useEffect } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import "./BarcodeScanner.css";

type BarcodeScannerProps = {
  onScan: (codigo: string) => void;
  onClose: () => void;
};

function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "reader",
      {
        fps: 10,
        qrbox: { width: 250, height: 160 },
      },
      false
    );

    scanner.render(
      (decodedText) => {
        onScan(decodedText);
        scanner.clear();
        onClose();
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [onScan, onClose]);

  return (
    <div className="scanner-overlay">
      <div className="scanner-card">
        <h2>Escanear código</h2>

        <div id="reader"></div>

        <button type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default BarcodeScanner;