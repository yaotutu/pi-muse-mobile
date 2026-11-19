package com.yaotutu.pimusemobile.sms

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReceiverModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsReceiver")

    Events("onSmsReceived")

    OnStartObserving {
      registerReceiver()
    }

    OnStopObserving {
      unregisterReceiver()
    }

    OnDestroy {
      unregisterReceiver()
    }

    Function("isSupported") {
      true
    }

    AsyncFunction("getInboxSmsInfo") {
      getInboxInfo()
    }

    AsyncFunction("readInboxSmsPage") { limit: Int, offset: Int ->
      readInboxPage(limit, offset)
    }
  }

  private fun getInboxInfo(): Map<String, Any> {
    val context = appContext.reactContext
      ?: return mapOf("permissionGranted" to false, "totalCount" to 0)
    val granted = context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
    if (!granted) {
      return mapOf("permissionGranted" to false, "totalCount" to 0)
    }
    var totalCount = 0
    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      arrayOf(Telephony.Sms._ID),
      null,
      null,
      null
    )?.use { cursor ->
      totalCount = cursor.count
    }
    return mapOf("permissionGranted" to true, "totalCount" to totalCount)
  }

  private fun readInboxPage(limit: Int, offset: Int): Map<String, Any> {
    val context = appContext.reactContext
      ?: return mapOf(
        "items" to emptyList<Map<String, Any>>(),
        "totalCount" to 0,
        "scanned" to 0,
        "nextOffset" to 0,
        "hasMore" to false
      )
    if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
      return mapOf(
        "items" to emptyList<Map<String, Any>>(),
        "totalCount" to 0,
        "scanned" to 0,
        "nextOffset" to 0,
        "hasMore" to false
      )
    }
    val bounded = limit.coerceIn(1, 500)
    val safeOffset = offset.coerceAtLeast(0)
    val projection = arrayOf(
      Telephony.Sms._ID,
      Telephony.Sms.ADDRESS,
      Telephony.Sms.BODY,
      Telephony.Sms.DATE
    )
    val items = mutableListOf<Map<String, Any>>()
    var totalCount = 0
    var scanned = 0
    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      null,
      null,
      "${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC"
    )?.use { cursor ->
      totalCount = cursor.count
      if (safeOffset < totalCount && cursor.moveToPosition(safeOffset)) {
        val idIndex = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
        val addrIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        do {
          scanned++
          val body = cursor.getString(bodyIndex) ?: ""
          if (body.isNotBlank()) {
            items.add(
              mapOf(
                "id" to (cursor.getString(idIndex) ?: ""),
                "sender" to (cursor.getString(addrIndex) ?: "Unknown"),
                "body" to body,
                "timestamp" to cursor.getLong(dateIndex)
              )
            )
          }
        } while (scanned < bounded && cursor.moveToNext())
      }
    }
    val nextOffset = safeOffset + scanned
    return mapOf(
      "items" to items,
      "totalCount" to totalCount,
      "scanned" to scanned,
      "nextOffset" to nextOffset,
      "hasMore" to (scanned > 0 && nextOffset < totalCount)
    )
  }

  private fun registerReceiver() {
    if (receiver != null) return
    val context = appContext.reactContext ?: return
    receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (intent?.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
          val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
          // 同条长短信的 PDU 分片共享发件人与时间。先拼原文再发事件，避免
          // 各分片使用同一个接入幂等键后冲突，导致只保存第一段。
          val grouped = messages.groupBy { msg ->
            Pair(msg.displayOriginatingAddress ?: msg.originatingAddress ?: "Unknown", msg.timestampMillis)
          }
          for ((identity, parts) in grouped) {
            val body = parts.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
            val (sender, timestamp) = identity
            this@SmsReceiverModule.sendEvent(
              "onSmsReceived",
              mapOf(
                "sender" to sender,
                "body" to body,
                "timestamp" to timestamp
              )
            )
          }
        }
      }
    }
    val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
  }

  private fun unregisterReceiver() {
    val context = appContext.reactContext ?: return
    receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (_: Exception) {}
    }
    receiver = null
  }
}
