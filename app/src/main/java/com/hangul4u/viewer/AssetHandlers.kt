package com.hangul4u.viewer

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

class ViewerAssetHandler(context: Context) : WebViewAssetLoader.PathHandler {
    private val appContext = context.applicationContext

    override fun handle(path: String): WebResourceResponse? {
        val relative = path.trimStart('/')
        if (relative.isEmpty() || relative.contains("..")) return null
        return try {
            val stream = appContext.assets.open("viewer/$relative")
            val mime = mimeFor(relative)
            val encoding = if (mime == "application/wasm") null else "utf-8"
            WebResourceResponse(mime, encoding, stream)
        } catch (_: IOException) {
            null
        }
    }
}

class DocumentHandler(
    private val documentBytes: AtomicReference<ByteArray?>,
    private val documentToken: AtomicReference<String>
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val token = path.trim('/').substringBefore('/')
        if (token.isEmpty() || token != documentToken.get()) return null
        val bytes = documentBytes.get() ?: return null
        val headers = mapOf(
            "Cache-Control" to "no-store",
            "Content-Length" to bytes.size.toString()
        )
        return WebResourceResponse(
            "application/octet-stream",
            null,
            200,
            "OK",
            headers,
            ByteArrayInputStream(bytes)
        )
    }
}

private fun mimeFor(path: String): String = when {
    path.endsWith(".html") -> "text/html"
    path.endsWith(".js") -> "text/javascript"
    path.endsWith(".css") -> "text/css"
    path.endsWith(".wasm") -> "application/wasm"
    path.endsWith(".svg") -> "image/svg+xml"
    path.endsWith(".txt") -> "text/plain"
    else -> "application/octet-stream"
}
