declare module "qrcode" {
    type QRCodeOptions = {
        errorCorrectionLevel?: "L" | "M" | "Q" | "H"
        type?: string
        width?: number
        margin?: number
        color?: {
            dark?: string
            light?: string
        }
    }

    interface QRCodeModule {
        toDataURL(text: string, options?: QRCodeOptions): Promise<string>
        toString(text: string, options?: QRCodeOptions): Promise<string>
    }

    const QRCode: QRCodeModule
    export default QRCode
}
