const menuToggle = document.querySelector('.menu-toggle')
const mainNav = document.querySelector('.main-nav')

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true'
  menuToggle.setAttribute('aria-expanded', String(!isOpen))
  mainNav?.classList.toggle('is-open', !isOpen)
})

mainNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false')
    mainNav.classList.remove('is-open')
  })
})

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      revealObserver.unobserve(entry.target)
    })
  },
  { threshold: 0.14 },
)

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element))

const countObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const element = entry.target
      const target = Number(element.dataset.count || 0)
      const suffix = element.dataset.suffix || ''
      const started = performance.now()
      const duration = 900

      const animate = (now) => {
        const progress = Math.min(1, (now - started) / duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        element.textContent = `${Math.round(target * eased)}${suffix}`
        if (progress < 1) requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
      countObserver.unobserve(element)
    })
  },
  { threshold: 0.7 },
)

document.querySelectorAll('[data-count]').forEach((element) => countObserver.observe(element))

const moduleContent = {
  field: {
    title: 'Campo',
    copy: 'Acompanhe rotas, evidências e atividades no lugar onde o trabalho realmente acontece. Menos mensagens soltas; mais contexto para agir.',
  },
  stock: {
    title: 'Estoque',
    copy: 'Veja cada entrada, retirada, kit e devolução com responsáveis, assinaturas e histórico — do almoxarifado até a obra.',
  },
  control: {
    title: 'Gestão',
    copy: 'Transforme dados de operação em uma leitura clara de equipes, obras, materiais e frota, sem montar relatórios à mão.',
  },
}

const dialog = document.querySelector('#module-dialog')
const dialogTitle = dialog?.querySelector('[data-dialog-title]')
const dialogCopy = dialog?.querySelector('[data-dialog-copy]')

document.querySelectorAll('[data-open-module]').forEach((button) => {
  button.addEventListener('click', () => {
    const content = moduleContent[button.dataset.openModule]
    if (!content || !dialog) return
    dialogTitle.textContent = content.title
    dialogCopy.textContent = content.copy
    dialog.showModal()
  })
})

dialog?.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close())
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close()
})

document.querySelectorAll('.module-card').forEach((card) => {
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    card.querySelector('[data-open-module]')?.click()
  })
})
