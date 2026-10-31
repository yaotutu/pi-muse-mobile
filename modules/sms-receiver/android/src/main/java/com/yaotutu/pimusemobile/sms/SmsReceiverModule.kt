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
          for (msg in messages) {
            val body = msg.displayMessageBody ?: msg.messageBody ?: ""
            val sender = msg.displayOriginatingAddress ?: msg.originatingAddress ?: "Unknown"
            val timestamp = msg.timestampMillis
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
