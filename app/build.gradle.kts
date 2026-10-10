plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

val appVersionName = "1.0.2"
val appVersionCode = 3
val generatedAssetsDir = layout.buildDirectory.dir("generated/hangul4u/assets")
val buildInfoFile = generatedAssetsDir.map { it.file("viewer/build-info.json") }

android {
    namespace = "com.hangul4u.viewer"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hangul4u.viewer"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedAssetsDir)
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
}

val rhwpProperty = (findProperty("rhwp") as String?)?.trim().orEmpty()
val syncRhwp = tasks.register<Exec>("syncRhwp") {
    description = "engine/rhwp.version(또는 -Prhwp=latest)에 맞는 @rhwp/core 을 뷰어 assets 에 넣는다."
    workingDir = rootProject.projectDir
    val args = mutableListOf("node", "tools/sync-rhwp.mjs")
    when {
        rhwpProperty.equals("latest", ignoreCase = true) -> args += "--latest"
        rhwpProperty.isNotEmpty() -> {
            args += "--version"
            args += rhwpProperty
        }
    }
    commandLine(args)
    // 네트워크·캐시 결과가 바뀌어도 항상 실행해 assets 를 맞춘다.
    outputs.upToDateWhen { false }
}

val writeViewerBuildInfo = tasks.register("writeViewerBuildInfo") {
    description = "안내 창에 쓸 버전·패키징 시각을 assets에 기록한다."
    dependsOn(syncRhwp)
    outputs.file(buildInfoFile)
    // 패키징 시각은 빌드마다 달라져야 하므로 캐시하지 않는다.
    outputs.upToDateWhen { false }
    doLast {
        val zone = TimeZone.getTimeZone("Asia/Seoul")
        val now = Date()
        val stampFormat = SimpleDateFormat("yyMMdd_HHmmss", Locale.US).apply { timeZone = zone }
        val displayFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply { timeZone = zone }
        val stamp = stampFormat.format(now)
        val packagedAt = displayFormat.format(now)
        val rhwpVersion = rootProject.file("engine/rhwp.version")
            .takeIf { it.exists() }
            ?.readText()
            ?.trim()
            .orEmpty()
        val out = buildInfoFile.get().asFile
        out.parentFile.mkdirs()
        out.writeText(
            """
            {
              "name": "Hangul4U",
              "version": "$appVersionName",
              "packagedAt": "$packagedAt",
              "stamp": "$stamp",
              "rhwpVersion": "$rhwpVersion"
            }
            """.trimIndent() + "\n"
        )
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(syncRhwp)
    dependsOn(writeViewerBuildInfo)
}

android.applicationVariants.configureEach {
    val variant = this
    val assembleTaskName = "assemble${variant.name.replaceFirstChar { it.uppercase() }}"
    tasks.matching { it.name == assembleTaskName }.configureEach {
        doLast {
            val info = buildInfoFile.get().asFile
            if (!info.exists()) {
                throw GradleException("build-info.json 이 없습니다. writeViewerBuildInfo 를 먼저 실행하세요.")
            }
            val stamp = Regex(""""stamp"\s*:\s*"([^"]+)"""")
                .find(info.readText())
                ?.groupValues
                ?.get(1)
                ?: throw GradleException("build-info.json 에서 stamp 를 읽지 못했습니다.")
            val apk = variant.outputs.single().outputFile
            if (!apk.exists()) {
                throw GradleException("APK 를 찾지 못했습니다: ${apk.path}")
            }
            val distDir = rootProject.layout.projectDirectory.dir("dist").asFile
            distDir.mkdirs()
            val targetName = "Hangul4U-${variant.name}_v${variant.versionName}_$stamp.apk"
            val target = distDir.resolve(targetName)
            apk.copyTo(target, overwrite = true)
            logger.lifecycle("Copied APK -> ${target.relativeTo(rootProject.projectDir)}")
        }
    }
}
