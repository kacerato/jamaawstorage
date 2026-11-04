import {
  Archivo_600SemiBold,
  Archivo_700Bold,
  useFonts as useArchivo,
} from '@expo-google-fonts/archivo'
import { Inter_400Regular, Inter_500Medium, useFonts as useInter } from '@expo-google-fonts/inter'
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  useFonts as useJetBrains,
} from '@expo-google-fonts/jetbrains-mono'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from './src/auth/AuthContext'
import { TabBar, type TabKey } from './src/components/TabBar'
import { ConsumptionScreen } from './src/screens/ConsumptionScreen'
import { LoginScreen } from './src/screens/LoginScreen'
import { StockScreen } from './src/screens/StockScreen'
import { VehiclesScreen } from './src/screens/VehiclesScreen'
import { color } from './src/theme/tokens'

/**
 * Jamaaw Almoxarifado — app do supervisor.
 *
 * Tres telas, de proposito: consumo, estoque e carros. O app e somente
 * leitura; cadastro, retirada, devolucao e triagem seguem no painel web.
 *
 * A navegacao e por estado local em vez de react-navigation: com tres abas
 * sem rota aninhada e sem deep link, a biblioteca custaria mais do que
 * resolve.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      {/* Fundo da barra vem de app.json (backgroundColor); aqui só o estilo dos ícones. */}
      <StatusBar style="light" />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  )
}

function Root() {
  const { authorized, initializing } = useAuth()
  const fontsLoaded = useAppFonts()

  if (!fontsLoaded || initializing) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={color.inkMute} />
      </View>
    )
  }

  if (!authorized) {
    return (
      <View style={styles.app}>
        <LoginScreen />
      </View>
    )
  }

  return <Shell />
}

function Shell() {
  const [tab, setTab] = useState<TabKey>('consumption')

  return (
    <View style={styles.app}>
      <View style={styles.body}>
        {tab === 'consumption' ? <ConsumptionScreen /> : null}
        {tab === 'stock' ? <StockScreen /> : null}
        {tab === 'vehicles' ? <VehiclesScreen /> : null}
      </View>

      <TabBar active={tab} onChange={setTab} />
    </View>
  )
}

/**
 * Archivo para titulo, Inter para texto, JetBrains Mono para numero —
 * as mesmas tres do site.
 */
function useAppFonts(): boolean {
  const [archivo] = useArchivo({ Archivo_600SemiBold, Archivo_700Bold })
  const [inter] = useInter({ Inter_400Regular, Inter_500Medium })
  const [jetBrains] = useJetBrains({ JetBrainsMono_500Medium, JetBrainsMono_700Bold })

  return archivo && inter && jetBrains
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: color.void },
  body: { flex: 1 },
  splash: {
    flex: 1,
    backgroundColor: color.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
