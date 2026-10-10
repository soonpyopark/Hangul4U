package com.hangul4u.viewer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val documentBytes = AtomicReference<ByteArray?>(null)
    private val documentToken = AtomicReference("")
    private var pageReady = false
    private var pendingName: String? = null
    private var pendingToken: String? = null
    private var pendingError: String? = null
    private var pendingOpenName: String? = null
    private var pendingOpenToken: String? = null
    private var openingToken: String? = null
    @Volatile private var arrowTyping = false

    private val openDocument = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) readAndDeliver(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", ViewerAssetHandler(this))
            .addPathHandler("/doc/", DocumentHandler(documentBytes, documentToken))
            .build()

        webView = WebView(this).also { view ->
            view.settings.javaScriptEnabled = true
            view.settings.allowFileAccess = false
            view.settings.setSupportZoom(false)
            view.settings.builtInZoomControls = false
            view.settings.displayZoomControls = false
            view.settings.useWideViewPort = true
            view.settings.loadWithOverviewMode = true
            view.settings.textZoom = 100
            view.settings.minimumFontSize = 1
            view.settings.minimumLogicalFontSize = 1
            view.settings.layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
            view.isFocusable = true
            view.isFocusableInTouchMode = true
            view.addJavascriptInterface(PickerBridge(), "Hangul4U")
            view.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ) = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    if (url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                    if (url.scheme == "http" || url.scheme == "https") {
                        runCatching {
                            startActivity(Intent(Intent.ACTION_VIEW, url))
                        }
                    }
                    return true
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    pageReady = true
                    flushPending()
                    view?.requestFocus()
                }
            }
        }
        setContentView(webView)
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript(
                        "(function(){return !!(window.hangul4u && window.hangul4u.consumeBack());})()"
                    ) { result ->
                        if (result != "true") finish()
                    }
                }
            }
        )
        webView.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html")
        handleViewIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleViewIntent(intent)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN &&
            event.isCtrlPressed &&
            !event.isAltPressed &&
            event.keyCode == KeyEvent.KEYCODE_G
        ) {
            webView.evaluateJavascript(
                "window.hangul4u && window.hangul4u.openGoto()",
                null
            )
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN &&
            !arrowTyping &&
            !event.isCtrlPressed &&
            !event.isAltPressed &&
            !event.isMetaPressed
        ) {
            val step = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_UP -> -1
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_DOWN -> 1
                else -> 0
            }
            if (step != 0) {
                webView.evaluateJavascript(
                    "window.hangul4u && window.hangul4u.pageStep($step)",
                    null
                )
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    fun launchPicker() {
        openDocument.launch(
            arrayOf(
                "application/x-hwp",
                "application/haansofthwp",
                "application/vnd.hancom.hwp",
                "application/vnd.hancom.hwpx",
                "application/hwp+zip",
                "application/octet-stream",
                "*/*"
            )
        )
    }

    private fun handleViewIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        readAndDeliver(uri)
    }

    private fun readAndDeliver(uri: Uri) {
        val name = displayName(uri)
        val token = System.nanoTime().toString()
        openingToken = token
        notifyOpening(name, token)
        lifecycleScope.launch {
            val bytes = try {
                withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { input ->
                        val data = input.readBytes()
                        if (data.size > MAX_BYTES) {
                            throw IllegalArgumentException("파일이 너무 큽니다. 80MB 이하만 열 수 있습니다.")
                        }
                        data
                    } ?: throw IllegalArgumentException("파일을 열 수 없습니다.")
                }
            } catch (error: Exception) {
                if (openingToken == token) queueError(error.message ?: "파일을 열 수 없습니다.")
                return@launch
            }
            if (openingToken != token) return@launch
            documentBytes.set(bytes)
            documentToken.set(token)
            pendingError = null
            pendingName = name
            pendingToken = token
            flushPending()
        }
    }

    private fun notifyOpening(name: String, token: String) {
        if (!pageReady) {
            pendingOpenName = name
            pendingOpenToken = token
            return
        }
        webView.evaluateJavascript(
            "window.hangul4u.beginOpen(${JSONObject.quote(name)}, ${JSONObject.quote(token)})",
            null
        )
    }

    private fun queueError(message: String) {
        pendingError = message
        pendingName = null
        pendingToken = null
        pendingOpenName = null
        pendingOpenToken = null
        openingToken = null
        flushPending()
    }

    private fun flushPending() {
        if (!pageReady) return
        val openName = pendingOpenName
        val openToken = pendingOpenToken
        pendingOpenName = null
        pendingOpenToken = null
        pendingError?.let { message ->
            pendingError = null
            webView.evaluateJavascript(
                "window.hangul4u.showError(${JSONObject.quote(message)})",
                null
            )
        }
        val name = pendingName ?: run {
            if (openName != null && openToken != null) {
                webView.evaluateJavascript(
                    "window.hangul4u.beginOpen(${JSONObject.quote(openName)}, ${JSONObject.quote(openToken)})",
                    null
                )
            }
            return
        }
        val token = pendingToken ?: return
        pendingName = null
        pendingToken = null
        val openCall = if (openName != null && openToken != null) {
            "window.hangul4u.beginOpen(${JSONObject.quote(openName)}, ${JSONObject.quote(openToken)});"
        } else {
            ""
        }
        webView.evaluateJavascript(
            openCall + "window.hangul4u.loadDocument(${JSONObject.quote(name)}, ${JSONObject.quote(token)})",
            null
        )
    }

    private fun displayName(uri: Uri): String {
        val projection = arrayOf(OpenableColumns.DISPLAY_NAME)
        contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                return cursor.getString(index) ?: "문서"
            }
        }
        return uri.lastPathSegment ?: "문서"
    }

    private inner class PickerBridge {
        @JavascriptInterface
        fun pickFile() {
            runOnUiThread { launchPicker() }
        }

        @JavascriptInterface
        fun setTyping(typing: Boolean) {
            arrowTyping = typing
        }
    }

    companion object {
        private const val MAX_BYTES = 80 * 1024 * 1024
    }
}
