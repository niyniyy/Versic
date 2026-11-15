
import type { Metadata } from "next";

import "./globals.css";


export const metadata: Metadata = {
    title: "versic. Hear deeper. Understand music.",
    description:
        "Upload a recording and see its spectrogram, notes, key and tempo.",
};


export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    return (
        <html lang="en">
            <body className="antialiased">
                {children}
            </body>
        </html>
    );
}
