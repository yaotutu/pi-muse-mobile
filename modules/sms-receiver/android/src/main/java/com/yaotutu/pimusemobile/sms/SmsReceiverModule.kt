package com.yaotutu.pimusemobile.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
